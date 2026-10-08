import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Band as FromIndex } from "@/components/ui";
import { BAND_ANGLE, Band, clampAngle } from "./band";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("clampAngle (#25 C3)", () => {
  it("keeps 30 to 45 degrees", () => {
    expect(BAND_ANGLE).toEqual({ min: 30, max: 45, fallback: 38 });
    expect(clampAngle(38)).toBe(38);
    expect(clampAngle(30)).toBe(30);
    expect(clampAngle(45)).toBe(45);
    expect(clampAngle(36.5)).toBe(36.5);
  });

  it("clamps outside the range and falls back to 38 for a non-number", () => {
    expect(clampAngle(8)).toBe(30);
    expect(clampAngle(-38)).toBe(30);
    expect(clampAngle(90)).toBe(45);
    expect(clampAngle(Number.NaN)).toBe(38);
    expect(clampAngle(Number.POSITIVE_INFINITY)).toBe(38);
  });
});

describe("Band (#25 C3)", () => {
  it("is exported from the ui index", () => {
    expect(FromIndex).toBe(Band);
  });

  it("rotates its strip by 38 degrees by default, clamped otherwise", () => {
    expect(html(<Band />)).toContain("rotate(38deg)");
    expect(html(<Band angle={60} />)).toContain("rotate(45deg)");
    expect(html(<Band angle={12} />)).toContain("rotate(30deg)");
    expect(html(<Band angle={60} />)).toContain('data-band-angle="45"');
  });

  it("fills with primary by default and pressed on request", () => {
    expect(html(<Band />)).toContain("bg-primary");
    expect(html(<Band />)).not.toContain("bg-pressed");
    const pressed = html(<Band tone="pressed" />);
    expect(pressed).toContain("bg-pressed");
    expect(pressed).not.toContain("bg-primary");
  });

  it("is presentational only without children", () => {
    expect(html(<Band />)).toMatch(/^<div[^>]*role="presentation"/);
    const labelled = html(
      <Band>
        <span>FILED</span>
      </Band>,
    );
    expect(labelled).not.toContain('role="presentation"');
    expect(labelled).toContain("<span>FILED</span>");
  });

  it("counter-rotates its children only when upright", () => {
    const upright = html(
      <Band angle={40} upright>
        <span>FILED</span>
      </Band>,
    );
    expect(upright).toContain("rotate(-40deg)");
    expect(upright).toContain("data-band-upright");
    const slanted = html(
      <Band angle={40}>
        <span>FILED</span>
      </Band>,
    );
    expect(slanted).not.toContain("rotate(-40deg)");
    expect(slanted).not.toContain("data-band-upright");
  });

  it("clips its strip so it never overflows its container", () => {
    expect(html(<Band className="h-40" />)).toMatch(
      /^<div[^>]*class="[^"]*overflow-hidden[^"]*h-40/,
    );
  });
});
