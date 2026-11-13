import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeviceTube as FromIndex, Star, Stamp } from "@/components/ui";
import { DeviceTube } from "./device-tube";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

// #932 C5: the Personnel file's nixie tube, a device primitive (the colour guard's `device` owner).
describe("DeviceTube", () => {
  it("is exported from the ui index", () => {
    expect(FromIndex).toBe(DeviceTube);
  });

  it("is a nixie device bezel: the glass lit by device-nixie, the tag under it, glyphs hidden", () => {
    const out = html(<DeviceTube value="42" tag="AVG WPM" spoken="Average WPM: 42" />);
    expect(out).toMatch(/^<div[^>]*data-device="nixie"/);
    expect(out).toContain("bg-device-bezel");
    expect(out).toMatch(
      /<span aria-hidden="true" data-tube=""[^>]*type-device device-nixie[^>]*>42</,
    );
    expect(out).toContain("var(--color-device-nixie-glow)");
    expect(out).toMatch(/<span aria-hidden="true"[^>]*>AVG WPM</);
    expect(out).toContain('<span class="sr-only">Average WPM: 42</span>');
  });

  it("the bezel prints a 4px offset and 10px padding (reference Profil.dc.html)", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/components/ui/device-tube.module.css"),
      "utf8",
    );
    expect(css).toMatch(/box-shadow: 4px 4px 0 var\(--color-room\)/);
    expect(css).toMatch(/padding: 10px;/);
    expect(css).toMatch(/font-size: 34px;/);
  });
});

// #932: the static page's stamp and stars are printed, not animated.
describe("still Stamp and Star", () => {
  it("a still stamp carries the still class and keeps its clamped angle", () => {
    const out = html(<Stamp still rotation={8} role={null} lines={["FILE", "VERIFIED"]} />);
    expect(out).toContain('data-stamp-still=""');
    expect(out).toContain('data-stamp-angle="6"');
  });

  it("a star without a spin is still, tilted", () => {
    const out = html(<Star size={46} tone="red" rotate={12} />);
    expect(out).toContain('data-star-still=""');
    expect(out).toContain("rotate(12deg)");
    expect(out).not.toContain("animation-duration");
    expect(html(<Star size={46} tone="red" spin={40} />)).toContain("animation-duration:40s");
  });
});
