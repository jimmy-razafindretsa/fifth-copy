import { describe, expect, it } from "vitest";
import { centredCrop, fitCrop, nudgeStep, panBy, withZoom, zoomOf } from "./crop";

// #60 C4: the dialog's crop maths, in source pixels, always inside the picture.
const pic = { width: 1200, height: 800 };

describe("crop", () => {
  it("starts on the largest centred square", () => {
    expect(centredCrop(pic)).toEqual({ x: 200, y: 0, size: 800 });
    expect(zoomOf(centredCrop(pic), pic)).toBe(1);
  });

  it("zooms around the centre and stays inside", () => {
    expect(withZoom(centredCrop(pic), 2, pic)).toEqual({ x: 400, y: 200, size: 400 });
    expect(withZoom(centredCrop(pic), 99, pic).size).toBe(200);
    expect(withZoom(centredCrop(pic), 0.1, pic).size).toBe(800);
  });

  it("pans opposite to the drag, scaled to the frame, clamped", () => {
    const zoomed = withZoom(centredCrop(pic), 2, pic); // 400 px under a 256 px frame
    expect(panBy(zoomed, -64, 0, 256, pic)).toEqual({ x: 500, y: 200, size: 400 });
    expect(panBy(zoomed, 10_000, 10_000, 256, pic)).toEqual({ x: 0, y: 0, size: 400 });
    expect(panBy(zoomed, -10_000, -10_000, 256, pic)).toEqual({ x: 800, y: 400, size: 400 });
  });

  it("rounds to whole pixels and nudges at least one", () => {
    expect(fitCrop({ x: 10.6, y: 3.2, size: 300.4 }, pic)).toEqual({ x: 11, y: 3, size: 300 });
    expect(nudgeStep({ x: 0, y: 0, size: 10 })).toBe(1);
    expect(nudgeStep({ x: 0, y: 0, size: 800 })).toBe(25);
  });
});
