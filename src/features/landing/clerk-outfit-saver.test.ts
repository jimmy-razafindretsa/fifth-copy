import { describe, expect, it, vi } from "vitest";
import type { SaveClerkOutfit, SaveClerkOutfitResult } from "@/features/identity";
import { outfitSaver } from "./clerk-outfit-saver";
import { clerkEmbedSrc, EMBEDS } from "./links";

const A = {
  hair: "side",
  glasses: "round",
  hat: "none",
  clothes: "vest",
  face: "stache",
  hairCol: "#4A3526",
};
const B = { ...A, hat: "ushanka" };
const C = { ...A, face: "beard" };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("outfitSaver (#687 C7)", () => {
  it("saves the first random issue when nothing is saved, then every change, never an echo", async () => {
    const save = vi.fn<SaveClerkOutfit>(async () => ({ saved: true }));
    const report = outfitSaver(save, null);
    report(A);
    report({ ...A });
    report(B);
    report(B);
    report(C);
    await flush();
    expect(save.mock.calls.map(([cfg]) => cfg)).toEqual([A, B, C]);
  });

  it("does not re-send the saved outfit's echo (?cfg= first frame)", async () => {
    const save = vi.fn<SaveClerkOutfit>(async () => ({ saved: true }));
    const report = outfitSaver(save, A);
    report({ ...A });
    expect(save).not.toHaveBeenCalled();
    report(B);
    expect(save).toHaveBeenCalledWith(B);
  });

  it("never calls out without a save action (a visitor without identity)", () => {
    const report = outfitSaver(null, null);
    expect(() => report(A)).not.toThrow();
  });

  it("retries after a refused or failed save", async () => {
    const save = vi
      .fn<(cfg: unknown) => Promise<SaveClerkOutfitResult>>()
      .mockResolvedValueOnce({ saved: false, reason: "no-viewer" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ saved: true });
    const report = outfitSaver(save, null);
    report(A);
    await flush();
    report(A);
    await flush();
    report(A);
    await flush();
    report(A);
    expect(save).toHaveBeenCalledTimes(3);
  });
});

describe("clerkEmbedSrc (#687 C7)", () => {
  it("is the plain page without a saved outfit", () => {
    expect(clerkEmbedSrc(null)).toBe(EMBEDS.clerk);
  });

  it("carries the saved outfit as URL-encoded JSON in ?cfg=", () => {
    const src = clerkEmbedSrc(A);
    expect(src).toBe(`/3d/clerk.html?cfg=${encodeURIComponent(JSON.stringify(A))}`);
    expect(JSON.parse(new URL(src, "http://x").searchParams.get("cfg")!)).toEqual(A);
  });
});
