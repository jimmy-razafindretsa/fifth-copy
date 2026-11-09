import type { Provider } from "next-auth/providers";
import Discord from "next-auth/providers/discord";
import GitHub from "next-auth/providers/github";

/** The provider variables of `src/env.ts`; each provider needs both its id and secret. */
export type OAuthEnv = {
  AUTH_GITHUB_ID?: string;
  AUTH_GITHUB_SECRET?: string;
  AUTH_DISCORD_ID?: string;
  AUTH_DISCORD_SECRET?: string;
};

export type OAuthProviderKey = "github" | "discord";

/** What a provider's profile() hands Auth.js (ADR 0009): provider id, login, avatar URL. Never an email. */
export type OAuthUser = { id: string; name: string; image: string | null };

type GitHubProfile = { id: number | string; login: string; avatar_url?: string | null };
type DiscordProfile = { id: string; username: string; avatar?: string | null };

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

const GITHUB_USER = "https://api.github.com/user";

/**
 * GitHub and Discord (ADR 0009, #49): `read:user` / `identify` only, never linked by email, profile()
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
  return providers;
}

/** The providers `oauthProviders(env)` registers, in button order (the sign-in screen hides the rest). */
export function enabledOAuthProviders(env: OAuthEnv): OAuthProviderKey[] {
  return oauthProviders(env).map((p) => (p as { id: string }).id as OAuthProviderKey);
}
