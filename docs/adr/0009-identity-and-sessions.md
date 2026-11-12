---
id: "0009"
title: Auth.js with JWT sessions, a signed guest cookie, no email, and short-lived race tokens
status: accepted
category: security
scope: ["src/server/auth/**", "src/features/identity/**", "src/proxy.ts", "prisma/schema/identity.prisma", "src/app/(auth)/**"]
supersedes: []
rule: Identity is resolved only by getViewer() in src/server/auth (session user or guest cookie); Auth.js uses the JWT session strategy with Credentials, GitHub, Discord and Google providers (minimal scopes, never linked by email); no email is ever stored; authorization happens inside server actions and route handlers, with proxy.ts doing optimistic redirects only; the race server trusts only race tokens minted by the web app.
---

# 0009. Auth.js with JWT sessions, a signed guest cookie, no email, and short-lived race tokens

## Context
Spec section 12: guests get an identity automatically (R145, R146); username + password, GitHub and Discord sign-in (R147-R151), Google sign-in (spec 12.1, owner decision 2026-11-09); no email, no "forgot password" (R152, R153); a one-time recovery code (R159, R160); guest history merges into the new account (R154); users are minors (R164, R165). Spec section 16.1 fixes Auth.js (NextAuth). Next.js 16 renamed middleware to `proxy.ts` and warns it is for optimistic checks only. Cards #30-#58, #165.

## Decision
- **Auth.js v5** (`next-auth@5`) with the **JWT session strategy** (cookie, no session table). Providers: Credentials (username + password, hashed with Argon2id), GitHub, Discord, Google (amendment below). The Prisma adapter stores `User` and `OAuthAccount`; the `email` column is absent from our model and never requested from providers (we only read id, login and avatar).
- **Guest identity:** on the first write that needs an identity (joining a lobby, starting a race) the web app creates a `User` with `isGuest = true` and a generated typist name, and sets a signed, HttpOnly cookie `fc_guest` (1 year). Reads never create guests. `getViewer()` returns the session user if signed in, else the guest from the cookie, else `null`.
- **Upgrade and merge:** signing up or signing in while `fc_guest` exists runs the merge transaction (race results, keystrokes, daily stats summed per key, achievements, bests) from the guest to the account, then deletes the guest row and clears the cookie (R154, card #56).
- **Recovery code:** 10 words from a bilingual list, shown once at sign-up, stored hashed; redeeming it sets a new password and rotates the code (R159, R160). No other recovery path.
- **Race token:** `features/lobby` mints an HS256 JWT (`jose`) per join: `sub` (user id), `name`, `lobby`, `role` (host|player|spectator), `avatar` (boolean), `exp` 5 min. The race server verifies it with `RACE_TOKEN_SECRET`. Tokens are fetched by the lobby page through a server action, never embedded in URLs.
- **Authorization:** inside every server action and route handler (`requireViewer()`, `requireHost(lobby)`), never only in the UI. `proxy.ts` only redirects signed-out users away from `/profile` and `/settings` and sets the locale cookie (ADR 0010).
- **Hardening:** `SameSite=Lax`, `Secure` in production, CSRF through Auth.js and server actions' origin check, sign-in and recovery throttled by the shared limiter (card #90), usernames pass the profanity filter (R161), under-13 copy next to the OAuth buttons (R164).
- **Sign-out revokes every device** (amendment, human decision 2026-10-04, card #87): the sign-out action bumps `User.tokenVersion` before Auth.js deletes the cookie, so every session JWT of the account, on every device, stops resolving (`accountViewer` compares the token's `tokenVersion` with the row's). A password reset or a recovery-code redeem bumps it the same way.
- **Google sign-in** (amendment, owner decision 2026-11-09, card #828): Google joins GitHub and Discord as an OAuth provider, registered only when `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set. Scopes `openid profile` only (never `email`), PKCE and state checked on the callback, `allowDangerousEmailAccountLinking: false`: accounts are never linked by email. Its profile() keeps the ID token's `sub`, the first name (`given_name`, which seeds the typist name through the same profanity screen; the full name and family name are dropped, as Google has no pseudonymous login) and the `picture` URL, imported once on the first sign-in from the exact host `lh3.googleusercontent.com` (ADR 0014). `OAuthProvider` gains `GOOGLE` through an additive migration.
- **Avatars:** stored as files under a private directory served through a route that checks lobby membership (R163); the storage backend is a separate ADR (card #59).

## Consequences
- No session table, so tokens expire naturally after 30 days; sign-out bumps `tokenVersion` (amended by #87: it signs the account out on every device, not only this browser), and password resets and recovery-code redeems bump it too, so old session cookies stop resolving.
- Guests who clear cookies lose their history (spec open question 20); the privacy page says so.
- Auth.js adapter expectations about `email` must be handled by a custom adapter wrapper or nullable column; this is a known rough edge to verify in card #38.

## Alternatives considered
- **Database sessions:** revocation is easier but adds a table and a query per request; `tokenVersion` gives us revocation without it. Rejected.
- **Lucia / custom auth:** full control, but the spec names Auth.js and OAuth providers are well covered. Rejected.
- **Guest = anonymous Auth.js session:** possible, but a plain signed cookie is simpler and keeps guests out of the OAuth account tables. Rejected.
