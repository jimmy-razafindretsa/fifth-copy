import type { Provider } from "next-auth/providers";
import Discord from "next-auth/providers/discord";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

/** The provider variables of `src/env.ts`; each provider needs both its id and secret. */
export type OAuthEnv = {
  AUTH_GITHUB_ID?: string;
  AUTH_GITHUB_SECRET?: string;
  AUTH_DISCORD_ID?: string;
  AUTH_DISCORD_SECRET?: string;
  AUTH_GOOGLE_ID?: string;
  AUTH_GOOGLE_SECRET?: string;
};

export type OAuthProviderKey = "github" | "discord" | "google";

/** What a provider's profile() hands Auth.js (ADR 0009): provider id, login, avatar URL. Never an email. */
export type OAuthUser = { id: string; name: string; image: string | null };

type GitHubProfile = { id: number | string; login: string; avatar_url?: string | null };
type DiscordProfile = { id: string; username: string; avatar?: string | null };
type GoogleProfile = { sub: string; given_name?: string | null; picture?: string | null };

/** GitHub `/user` -> `{ id, name: login, image }`; name, email, bio and the rest are dropped. */
export function githubProfile(profile: GitHubProfile): OAuthUser {
  return { id: String(profile.id), name: profile.login, image: profile.avatar_url ?? null };
}

/** Discord `/users/@me` -> `{ id, name: username, image }`; global name, email, locale... dropped. */
export function discordProfile(profile: DiscordProfile): OAuthUser {
  const image = profile.avatar
    ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${profile.avatar.startsWith("a_") ? "gif" : "png"}`
    : null;
  return { id: profile.id, name: profile.username, image };
}

/**
 * Google ID token claims (`openid profile`) -> `{ id: sub, name: given_name, image: picture }` (#828,
 * ADR 0009). Google has no pseudonymous login, so only the first name seeds the typist name (the full
 * `name` and `family_name` are dropped; no name at all gives the "Typist-NNN" fallback). No email:
 * the `email` scope is never requested, and the claim would be dropped here anyway.
 */
export function googleProfile(profile: GoogleProfile): OAuthUser {
  const name = typeof profile.given_name === "string" ? profile.given_name : "";
  const image =
    typeof profile.picture === "string" && profile.picture !== "" ? profile.picture : null;
  // oauth4webapi already requires `sub`; refuse an empty one rather than link every such sign-in to one id.
  if (typeof profile.sub !== "string" || profile.sub === "")
    throw new Error("Google profile without sub");
  return { id: profile.sub, name, image };
}

const GITHUB_USER = "https://api.github.com/user";
/** Google's documented authorization endpoint, pinned so a sign-in press needs no discovery request. */
const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * GitHub, Discord (ADR 0009, #49) and Google (#828): `read:user` / `identify` / `openid profile` only, never linked by email, profile()
 * maps id, login and avatar, PKCE and state both checked on the callback. GitHub's default userinfo also fetches `/user/emails` when the profile has no
 * public email; ours reads `/user` only. A provider whose id or secret is missing is not registered.
 */
export function oauthProviders(env: OAuthEnv): Provider[] {
  const providers: Provider[] = [];
  if (env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET) {
    providers.push(
      GitHub({
        clientId: env.AUTH_GITHUB_ID,
        clientSecret: env.AUTH_GITHUB_SECRET,
        authorization: { params: { scope: "read:user" } },
        userinfo: {
          url: GITHUB_USER,
          async request({ tokens }: { tokens: { access_token?: string } }) {
            const res = await fetch(GITHUB_USER, {
              headers: {
                Authorization: `Bearer ${tokens.access_token}`,
                "User-Agent": "fifth-copy",
              },
            });
            if (!res.ok) throw new Error(`GitHub /user answered ${res.status}`);
            return res.json();
          },
        },
        checks: ["pkce", "state"],
        allowDangerousEmailAccountLinking: false,
        profile: githubProfile,
      }),
    );
  }
  if (env.AUTH_DISCORD_ID && env.AUTH_DISCORD_SECRET) {
    providers.push(
      Discord({
        clientId: env.AUTH_DISCORD_ID,
        clientSecret: env.AUTH_DISCORD_SECRET,
        authorization: { params: { scope: "identify" } },
        checks: ["pkce", "state"],
        allowDangerousEmailAccountLinking: false,
        profile: discordProfile,
      }),
    );
  }
  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
    providers.push(
      Google({
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
        authorization: { url: GOOGLE_AUTHORIZE, params: { scope: "openid profile" } },
        checks: ["pkce", "state"],
        allowDangerousEmailAccountLinking: false,
        profile: googleProfile,
      }),
    );
  }
  return providers;
}

/** The providers `oauthProviders(env)` registers, in button order (the sign-in screen hides the rest). */
export function enabledOAuthProviders(env: OAuthEnv): OAuthProviderKey[] {
  return oauthProviders(env).map((p) => (p as { id: string }).id as OAuthProviderKey);
}
