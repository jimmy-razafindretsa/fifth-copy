import { describe, expect, it, vi } from "vitest";

// #539: the hooks the Auth.js route registers hand a new account's provider picture to #52's
// importOauthAvatar, unchanged (it never rejects and stores only the avatar key).
const importOauthAvatar = vi.hoisted(() => vi.fn());
vi.mock("./avatars/import-oauth-avatar", () => ({ importOauthAvatar }));
vi.mock("./merge/merge-on-sign-in", () => ({ mergeGuestCookieInto: vi.fn() }));
vi.mock("./preferences/cookies", () => ({ refreshPreferenceCookies: vi.fn() }));
vi.mock("./auth/throttle", () => ({ withCredentialsThrottle: vi.fn() }));

const { oauthSignInHooks } = await import("./server");

describe("oauthSignInHooks.importAvatar (#539)", () => {
  it("delegates to importOauthAvatar with the account id and the provider URL", async () => {
    importOauthAvatar.mockResolvedValueOnce({ imported: true, key: "k" });
    const url = "https://avatars.githubusercontent.com/u/1?v=4";
    await expect(oauthSignInHooks.importAvatar("acc1", url)).resolves.toEqual({
      imported: true,
      key: "k",
    });
    expect(importOauthAvatar).toHaveBeenCalledExactlyOnceWith("acc1", url);
  });
});
