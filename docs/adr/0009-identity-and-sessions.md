---
id: "0009"
title: Auth.js with JWT sessions, a signed guest cookie, no email, and short-lived race tokens
status: proposed
category: security
scope: ["src/server/auth/**", "src/features/identity/**", "src/proxy.ts", "prisma/schema/identity.prisma", "src/app/(auth)/**"]
supersedes: []
rule: Identity is resolved only by getViewer() in src/server/auth (session user or guest cookie); Auth.js uses the JWT session strategy with Credentials, GitHub and Discord providers; no email is ever stored; authorization happens inside server actions and route handlers, with proxy.ts doing optimistic redirects only; the race server trusts only race tokens minted by the web app.
---

# 0009. Auth.js with JWT sessions, a signed guest cookie, no email, and short-lived race tokens

## Context
Spec section 12: guests get an identity automatically (R145, R146); username + password, GitHub and Discord sign-in (R147-R151); no email, no "forgot password" (R152, R153); a one-time recovery code (R159, R160); guest history merges into the new account (R154); users are minors (R164, R165). Spec section 16.1 fixes Auth.js (NextAuth). Next.js 16 renamed middleware to `proxy.ts` and warns it is for optimistic checks only. Cards #30-#58, #165.

## Decision
- **Auth.js v5** (`next-auth@5`) with the **JWT session strategy** (cookie, no session table). Providers: Credentials (username + password, hashed with Argon2id), GitHub, Discord. The Prisma adapter stores `User` and `OAuthAccount`; the `email` column is absent from our model and never requested from providers (we only read id, login and avatar).
- **Guest identity:** on the first write that needs an identity (joining a lobby, starting a race) the web app creates a `User` with `isGuest = true` and a generated typist name, and sets a signed, HttpOnly cookie `fc_guest` (1 year). Reads never create guests. `getViewer()` returns the session user if signed in, else the guest from the cookie, else `null`.
- **Upgrade and merge:** signing up or signing in while `fc_guest` exists runs the merge transaction (race results, keystrokes, daily stats summed per key, achievements, bests) from the guest to the account, then deletes the guest row and clears the cookie (R154, card #56).
- **Recovery code:** 10 words from a bilingual list, shown once at sign-up, stored hashed; redeeming it sets a new password and rotates the code (R159, R160). No other recovery path.
- **Race token:** `features/lobby` mints an HS256 JWT (`jose`) per join: `sub` (user id), `name`, `lobby`, `role` (host|player|spectator), `avatar` (boolean), `exp` 5 min. The race server verifies it with `RACE_TOKEN_SECRET`. Tokens are fetched by the lobby page through a server action, never embedded in URLs.
- **Authorization:** inside every server action and route handler (`requireViewer()`, `requireHost(lobby)`), never only in the UI. `proxy.ts` only redirects signed-out users away from `/profile` and `/settings` and sets the locale cookie (ADR 0010).
- **Hardening:** `SameSite=Lax`, `Secure` in production, CSRF through Auth.js and server actions' origin check, sign-in and recovery throttled by the shared limiter (card #90), usernames pass the profanity filter (R161), under-13 copy next to the OAuth buttons (R164).
- **Avatars:** stored as files under a private directory served through a route that checks lobby membership (R163); the storage backend is a separate ADR (card #59).

## Consequences
- No session table, so sign-out is cookie deletion and tokens expire naturally; password changes rotate the JWT secret claim (`tokenVersion` on the user) to invalidate old sessions.
- Guests who clear cookies lose their history (spec open question 20); the privacy page says so.
- Auth.js adapter expectations about `email` must be handled by a custom adapter wrapper or nullable column; this is a known rough edge to verify in card #38.

## Alternatives considered
- **Database sessions:** revocation is easier but adds a table and a query per request; `tokenVersion` gives us revocation without it. Rejected.
- **Lucia / custom auth:** full control, but the spec names Auth.js and OAuth providers are well covered. Rejected.
- **Guest = anonymous Auth.js session:** possible, but a plain signed cookie is simpler and keeps guests out of the OAuth account tables. Rejected.
