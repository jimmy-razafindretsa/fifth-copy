import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Monogram as FromIndex } from "@/components/ui";
import { viewBox } from "../../../../scripts/lib/brand-svg";
import { BRAND_MARKS } from "./assets";
import { Monogram, type MonogramVariant } from "./monogram";

const svgOf = (name: string) =>
  readFileSync(path.join(process.cwd(), "public/brand", `${name}.svg`), "utf8");
const VARIANTS: MonogramVariant[] = ["paper", "red", "ink"];
const attr = (html: string, name: string) => html.match(new RegExp(` ${name}="([^"]+)"`))?.[1];

describe("Monogram (#24 C2, C4)", () => {
  describe.each(VARIANTS)("%s", (variant) => {
    const file = `monogram-${variant}` as const;
    const source = svgOf(file);

    it("at size 16 is a 16x16 inline svg on the asset's square viewBox", () => {
      const html = renderToStaticMarkup(
        <Monogram variant={variant} size={16} title="Fifth Copy" clearSpace={false} />,
      );
      expect(html).toMatch(/^<svg role="img" /);
      expect(html).toContain("<title>Fifth Copy</title>");
      expect(attr(html, "width")).toBe("16");
      expect(attr(html, "height")).toBe("16");
      expect(attr(html, "viewBox")).toBe(source.match(/viewBox="([^"]+)"/)?.[1]);
    });

    it("pads the square viewBox by one bar height unless clearSpace={false}", () => {
      const html = renderToStaticMarkup(<Monogram variant={variant} size={64} title="FC" />);
      const [x, y, w, h] = viewBox(source) as [number, number, number, number];
      const c = BRAND_MARKS[file].clearSpace;
      const vb = viewBox(html);
      [x - c, y - c, w + 2 * c, h + 2 * c].forEach((v, i) =>
        expect(Math.abs(v - vb[i]!)).toBeLessThanOrEqual(0.01),
      );
      expect(vb[2]).toBe(vb[3]);
      expect(attr(html, "width")).toBe("64");
      expect(attr(html, "height")).toBe("64");
    });

    it("keeps its own tile: fills only through primary, band and band-fg", () => {
      const html = renderToStaticMarkup(<Monogram variant={variant} size={32} title="FC" />);
      const classes = [...html.matchAll(/<path class="([^"]+)"/g)].map((m) => m[1]);
      expect(classes).toHaveLength(BRAND_MARKS[file].paths.length);
      for (const c of classes) expect(["fill-primary", "fill-band", "fill-band-fg"]).toContain(c);
      expect(html).not.toMatch(/fill-fg|#[0-9A-Fa-f]{3,8}\b|--brand-/);
    });
  });

  it("defaults to 32 px", () => {
    const html = renderToStaticMarkup(<Monogram variant="red" title="FC" />);
    expect(attr(html, "width")).toBe("32");
  });

  it("is exported from the ui index", () => {
    expect(FromIndex).toBe(Monogram);
  });
});
