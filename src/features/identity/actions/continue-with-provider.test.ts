import { beforeEach, describe, expect, it, vi } from "vitest";
import { form, harnessModules, redirectOf } from "../testing/auth-harness";

// #36 C8, #49: a configured provider (GitHub, Discord) starts Auth.js's OAuth flow with the safe
// callbackUrl; any other provider press returns to /sign-in with the OAuth error banner; an unknown
// provider is a Configuration error.
vi.mock("next/navigation", () => harnessModules.navigation());
const signIn = vi.fn<(provider: string, opts: { redirectTo: string }) => Promise<undefined>>(
  async () => undefined,
);
const enabled = vi.fn((): string[] => ["github", "discord"]);
vi.mock("@/server/auth", () => ({ signIn, enabledOAuthProviders: () => enabled() }));
vi.mock("@/env", () => ({ env: {} }));

const { continueWithProvider } = await import("./continue-with-provider");
const { OAUTH_PROVIDERS } = await import("../schema");

describe("continueWithProvider (#36 C8, #49)", () => {
  beforeEach(() => {
    signIn.mockClear();
    enabled.mockReturnValue(["github", "discord"]);
  });

  it("offers GitHub, Discord and Google, in that order", () => {
    expect(OAUTH_PROVIDERS).toEqual(["github", "discord", "google"]);
  });

  it.each(["github", "discord"])("%s starts the Auth.js OAuth flow", async (provider) => {
    await continueWithProvider(form({ provider, callbackUrl: "/locker" }));
    expect(signIn).toHaveBeenCalledExactlyOnceWith(provider, { redirectTo: "/locker" });
  });

  it("an off-site callbackUrl is dropped before Auth.js sees it", async () => {
    await continueWithProvider(form({ provider: "github", callbackUrl: "https://evil.example/" }));
    expect(signIn).toHaveBeenCalledExactlyOnceWith("github", { redirectTo: "/" });
  });

  it("a provider without its env vars returns to /sign-in with the OAuthSignin banner", async () => {
    enabled.mockReturnValue([]);
    expect(await redirectOf(() => continueWithProvider(form({ provider: "github" })))).toBe(
      "/sign-in?error=OAuthSignin",
    );
    expect(signIn).not.toHaveBeenCalled();
  });

  it("Google (no provider under ADR 0009) keeps a safe callbackUrl and drops an off-site one", async () => {
    expect(
      await redirectOf(() =>
        continueWithProvider(form({ provider: "google", callbackUrl: "/locker" })),
      ),
    ).toBe("/sign-in?error=OAuthSignin&callbackUrl=%2Flocker");
    expect(
      await redirectOf(() =>
        continueWithProvider(form({ provider: "google", callbackUrl: "https://evil.example/" })),
      ),
    ).toBe("/sign-in?error=OAuthSignin");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("an unknown provider is a Configuration error", async () => {
    expect(await redirectOf(() => continueWithProvider(form({ provider: "apple" })))).toBe(
      "/sign-in?error=Configuration",
    );
  });
});
