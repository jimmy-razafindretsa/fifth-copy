import { describe, expect, it } from "vitest";
import {
  discordProfile,
  enabledOAuthProviders,
  githubProfile,
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

type Built = {
  id: string;
  authorization: { params: { scope: string } };
  options: { allowDangerousEmailAccountLinking?: boolean; authorization?: unknown };
  profile: (p: unknown) => unknown;
};

/** The provider as Auth.js resolves it: the config's own fields win over the defaults (`options`). */
function resolved(provider: unknown) {
  const p = provider as Built;
  const scope =
    (p.options.authorization as { params?: { scope?: string } } | undefined)?.params?.scope ??
    p.authorization.params.scope;
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

describe("OAuth providers (#49 C1)", () => {
  it("GitHub asks for read:user only and Discord for identify only", () => {
    const [github, discord] = oauthProviders(BOTH).map(resolved);
    expect(github?.id).toBe("github");
    expect(github?.scope).toBe("read:user");
    expect(discord?.id).toBe("discord");
    expect(discord?.scope).toBe("identify");
  });

  it("never links accounts by email, and checks PKCE and state on the callback", () => {
    for (const provider of oauthProviders(BOTH).map(resolved)) {
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
    expect(oauthProviders(BOTH).map((p) => (p as unknown as Built).id)).toEqual([
      "github",
      "discord",
    ]);
  });
});
