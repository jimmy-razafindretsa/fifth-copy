import { describe, expect, it } from "vitest";
import {
  discordProfile,
  enabledOAuthProviders,
  githubProfile,
  googleProfile,
  oauthProviders,
  type OAuthEnv,
} from "./providers";

// #49 C1, C2 (ADR 0009): GitHub `read:user` and Discord `identify` only, no email-based linking, profile()
// keeps provider id, login and avatar URL and nothing else; a provider without its env vars is absent.

const BOTH: OAuthEnv = {
  AUTH_GITHUB_ID: "gh-id",
  AUTH_GITHUB_SECRET: "gh-secret",
  AUTH_DISCORD_ID: "dc-id",
  AUTH_DISCORD_SECRET: "dc-secret",
};

const ALL: OAuthEnv = { ...BOTH, AUTH_GOOGLE_ID: "go-id", AUTH_GOOGLE_SECRET: "go-secret" };

type Built = {
  id: string;
  type?: string;
  authorization?: { params: { scope: string } };
  options: { allowDangerousEmailAccountLinking?: boolean; authorization?: unknown };
  profile: (p: unknown) => unknown;
};

/** The provider as Auth.js resolves it: the config's own fields win over the defaults (`options`). */
function resolved(provider: unknown) {
  const p = provider as Built;
  const scope =
    (p.options.authorization as { params?: { scope?: string } } | undefined)?.params?.scope ??
    p.authorization?.params.scope;
  return { id: p.id, scope, options: p.options };
}

const githubFixture = {
  id: 583231,
  login: "octocat",
  name: "The Octocat",
  avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
  email: "octocat@github.example",
  company: "@github",
  location: "San Francisco",
  bio: "a bio",
};

const discordFixture = {
  id: "80351110224678912",
  username: "nelly",
  global_name: "Nelly",
  discriminator: "0",
  avatar: "8342729096ea3675442027381ff50dfe",
  email: "nelly@discord.example",
  verified: true,
  locale: "en-US",
};

// Google ID token claims for `openid profile` (plus an email, as if a wider scope had been granted).
const googleFixture = {
  iss: "https://accounts.google.com",
  aud: "go-id",
  sub: "110169484474386276334",
  name: "Ada Lovelace",
  given_name: "Ada",
  family_name: "Lovelace",
  picture: "https://lh3.googleusercontent.com/a/ACg8ocJ-example=s96-c",
  locale: "en",
  email: "ada@google.example",
  email_verified: true,
};

describe("OAuth providers (#49 C1)", () => {
  it("GitHub asks for read:user only and Discord for identify only", () => {
    const [github, discord] = oauthProviders(BOTH).map(resolved);
    expect(github?.id).toBe("github");
    expect(github?.scope).toBe("read:user");
    expect(discord?.id).toBe("discord");
    expect(discord?.scope).toBe("identify");
  });

  it("Discord's issuer matches the `iss` Discord sends on the callback, so the sign-in is not refused", () => {
    const discord = oauthProviders(BOTH).map(resolved)[1];
    expect(discord?.options).toMatchObject({ issuer: "https://discord.com" });
  });

  it("never links accounts by email, and checks PKCE and state on the callback", () => {
    for (const provider of oauthProviders(ALL).map(resolved)) {
      expect(provider.options.allowDangerousEmailAccountLinking).toBe(false);
      expect(provider.options).toMatchObject({ checks: ["pkce", "state"] });
    }
  });

  it("the configured profile() is the mapper, so Auth.js never sees an email", () => {
    const [github, discord] = oauthProviders(BOTH) as unknown as Built[];
    expect(github?.options).toMatchObject({ profile: githubProfile });
    expect(discord?.options).toMatchObject({ profile: discordProfile });
  });

  it("maps a GitHub profile to { id, name: login, image } and drops every other field", () => {
    const user = githubProfile(githubFixture);
    expect(user).toEqual({
      id: "583231",
      name: "octocat",
      image: "https://avatars.githubusercontent.com/u/583231?v=4",
    });
    expect(JSON.stringify(user)).not.toContain("example");
  });

  it("maps a Discord profile to { id, name: username, image } and drops every other field", () => {
    const user = discordProfile(discordFixture);
    expect(user).toEqual({
      id: "80351110224678912",
      name: "nelly",
      image:
        "https://cdn.discordapp.com/avatars/80351110224678912/8342729096ea3675442027381ff50dfe.png",
    });
    expect(JSON.stringify(user)).not.toContain("example");
  });

  it("a Discord profile without an avatar gets no image (no provider default is imported)", () => {
    expect(discordProfile({ ...discordFixture, avatar: null })).toEqual({
      id: "80351110224678912",
      name: "nelly",
      image: null,
    });
  });
});

describe("Google provider (#828 C3)", () => {
  it("is an OIDC provider asking for `openid profile` only, at Google's pinned authorize URL", () => {
    const google = oauthProviders(ALL).find((p) => (p as unknown as Built).id === "google");
    const built = google as unknown as Built;
    expect(built.type).toBe("oidc");
    const auth = built.options.authorization as { url: string; params: { scope: string } };
    expect(auth.url).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(auth.params).toEqual({ scope: "openid profile" });
    expect(resolved(google).scope).toBe("openid profile");
    expect(built.options).toMatchObject({
      checks: ["pkce", "state"],
      allowDangerousEmailAccountLinking: false,
      profile: googleProfile,
    });
  });

  it("maps the ID token claims to { id: sub, name: given_name, image: picture } and drops the rest", () => {
    const user = googleProfile(googleFixture);
    expect(user).toEqual({
      id: "110169484474386276334",
      name: "Ada",
      image: "https://lh3.googleusercontent.com/a/ACg8ocJ-example=s96-c",
    });
    expect(JSON.stringify(user)).not.toContain('example"');
    expect(JSON.stringify(user)).not.toContain("Lovelace");
    expect(JSON.stringify(user)).not.toContain("@");
  });

  it("no first name or picture gives an empty name (typist-name fallback) and no image", () => {
    expect(googleProfile({ sub: "1", given_name: null, picture: "" })).toEqual({
      id: "1",
      name: "",
      image: null,
    });
    expect(googleProfile({ sub: "2" })).toEqual({ id: "2", name: "", image: null });
  });

  it("refuses claims without a subject, so two sign-ins can never share an empty id", () => {
    expect(() => googleProfile({ sub: "" })).toThrow();
    expect(() => googleProfile({} as never)).toThrow();
  });
});

describe("OAuth providers from the env (#49 C2)", () => {
  it("registers nothing without the variables, so development without secrets runs", () => {
    expect(oauthProviders({})).toEqual([]);
    expect(enabledOAuthProviders({})).toEqual([]);
  });

  it("registers a provider only when both its id and secret are set", () => {
    const githubOnly = { AUTH_GITHUB_ID: "gh-id", AUTH_GITHUB_SECRET: "gh-secret" };
    expect(enabledOAuthProviders(githubOnly)).toEqual(["github"]);
    expect(enabledOAuthProviders({ ...githubOnly, AUTH_DISCORD_ID: "dc-id" })).toEqual(["github"]);
    expect(enabledOAuthProviders(BOTH)).toEqual(["github", "discord"]);
    expect(enabledOAuthProviders({ AUTH_GOOGLE_ID: "go-id" })).toEqual([]);
    expect(enabledOAuthProviders(ALL)).toEqual(["github", "discord", "google"]);
    expect(oauthProviders(BOTH).map((p) => (p as unknown as Built).id)).toEqual([
      "github",
      "discord",
    ]);
  });
});
