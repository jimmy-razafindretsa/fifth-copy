import { describe, expect, it, vi } from "vitest";
import { form, harnessModules, redirectOf } from "../testing/auth-harness";

// #36 C8: until #49 configures the OAuth providers, every provider press (GitHub, Discord, Google)
// returns to /sign-in with the OAuth callback error banner; an unknown provider is a Configuration error.
vi.mock("next/navigation", () => harnessModules.navigation());

const { continueWithProvider } = await import("./continue-with-provider");
const { OAUTH_PROVIDERS } = await import("../schema");

describe("continueWithProvider (#36 C8)", () => {
  it("offers GitHub, Discord and Google, in that order", () => {
    expect(OAUTH_PROVIDERS).toEqual(["github", "discord", "google"]);
  });

  it.each(OAUTH_PROVIDERS)(
    "%s returns to /sign-in with the OAuthSignin banner",
    async (provider) => {
      expect(await redirectOf(() => continueWithProvider(form({ provider })))).toBe(
        "/sign-in?error=OAuthSignin",
      );
    },
  );

  it("keeps a safe callbackUrl and drops an off-site one", async () => {
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
  });

  it("an unknown provider is a Configuration error", async () => {
    expect(await redirectOf(() => continueWithProvider(form({ provider: "apple" })))).toBe(
      "/sign-in?error=Configuration",
    );
  });
});
