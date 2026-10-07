import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Wordmark as FromIndex } from "@/components/ui";
import { bar, viewBox } from "../../../../scripts/lib/brand-svg";
import { Wordmark, type WordmarkVariant } from "./wordmark";

const root = process.cwd();
const guide = readFileSync(path.join(root, "docs/design/logo.md"), "utf8");
const svgOf = (name: string) =>
  readFileSync(path.join(root, "public/brand", `${name}.svg`), "utf8");

/** The Clear space table of docs/design/logo.md: asset -> viewBox units. */
const CLEAR = Object.fromEntries(
  (guide.split(/^## /m).find((s) => s.startsWith("Clear space")) ?? "")
    .split("\n")
    .filter((l) => /^\| `[a-z-]+` \|/.test(l))
    .map((l) => l.split("|").map((c) => c.trim().replace(/`/g, "")))
    .map((r) => [r[1], Number(r[2])]),
) as Record<string, number>;

/** Each `<path>` of the rendered markup: its class and d. */
const pathsOf = (html: string) =>
  [...html.matchAll(/<path class="([^"]+)" d="([^"]+)"/g)].map((m) => ({
    cls: m[1]!,
    d: m[2]!,
  }));

const FILL_OF_HEX: Record<string, string> = {
  "#B81D24": "fill-primary",
  "#2A2420": "fill-band",
  "#F1E8D6": "fill-band-fg",
};

const CASES: { variant: WordmarkVariant; tagline: boolean; file: string; bar: string }[] = [
  { variant: "red-on-paper", tagline: false, file: "wordmark-red-on-paper", bar: "fill-primary" },
  { variant: "ink-on-red", tagline: false, file: "wordmark-ink-on-red", bar: "fill-band" },
  { variant: "red-on-ink", tagline: false, file: "wordmark-red-on-ink", bar: "fill-primary" },
  {
    variant: "red-on-paper",
    tagline: true,
    file: "wordmark-tagline-red-on-paper",
    bar: "fill-primary",
  },
];

const render = (c: (typeof CASES)[number], clearSpace?: boolean) =>
  renderToStaticMarkup(
    c.variant === "red-on-paper" ? (
      <Wordmark
        variant="red-on-paper"
        tagline={c.tagline}
        title="Fifth Copy"
        clearSpace={clearSpace}
      />
    ) : (
      <Wordmark variant={c.variant} title="Fifth Copy" clearSpace={clearSpace} />
    ),
  );

describe("Wordmark (#24 C1, C4)", () => {
  describe.each(CASES)("$file", (c) => {
    const html = render(c);
    const paths = pathsOf(html);
    const source = svgOf(c.file);

    it("is an inline svg role=img named by its <title>", () => {
      expect(html).toMatch(/^<svg role="img" /);
      expect(html).toContain("<title>Fifth Copy</title>");
      expect(html).toContain(`data-mark="${c.file}"`);
    });

    it("fills the bar with its role and every letter with the asset's ink or paper role", () => {
      const barD = `M${bar(source)
        .map(([x, y]) => `${x} ${y}`)
        .join("L")}`;
      expect(paths.find((p) => p.d === barD)?.cls).toBe(c.bar);
      const fills = [...source.matchAll(/fill="(#[0-9A-F]{6})"/g)].map((m) => FILL_OF_HEX[m[1]!]);
      expect(paths.map((p) => p.cls)).toEqual(fills);
      for (const { cls } of paths)
        expect(["fill-primary", "fill-band", "fill-band-fg"]).toContain(cls);
    });

    it("references no themed ink, raw hex or brand variable", () => {
      expect(html).not.toMatch(/fill-fg|#[0-9A-Fa-f]{3,8}\b|--brand-/);
    });

    it("reserves one bar height of clear space on every side, or none when clearSpace={false}", () => {
      const [x, y, w, h] = viewBox(source) as [number, number, number, number];
      const cs = CLEAR[c.file]!;
      expect(cs).toBeGreaterThan(0);
      const padded = viewBox(html).map((v, i) => v - [x - cs, y - cs, w + 2 * cs, h + 2 * cs][i]!);
      for (const delta of padded) expect(Math.abs(delta)).toBeLessThanOrEqual(0.01);
      expect(viewBox(render(c, false))).toEqual([x, y, w, h]);
    });
  });

  it("keeps the asset's aspect ratio at the requested width", () => {
    const html = renderToStaticMarkup(<Wordmark variant="red-on-ink" title="F" width={300} />);
    const [, , w, h] = viewBox(html) as [number, number, number, number];
    const width = Number(html.match(/ width="([\d.]+)"/)?.[1]);
    const height = Number(html.match(/ height="([\d.]+)"/)?.[1]);
    expect(width).toBe(300);
    expect(Math.abs(height - (300 * h) / w)).toBeLessThanOrEqual(0.01);
  });

  it("allows the tagline only on red-on-paper (type-level)", () => {
    // @ts-expect-error the tagline wordmark exists only as red-on-paper
    const bad = <Wordmark variant="ink-on-red" tagline title="F" />;
    expect(bad).toBeTruthy();
  });

  it("is exported from the ui index", () => {
    expect(FromIndex).toBe(Wordmark);
  });

  it("brand sources name no violet, gold or still-to-type role", () => {
    const dir = path.join(root, "src/components/ui/brand");
    const banned = new RegExp(["riv" + "al", "rew" + "ard", "unty" + "ped"].join("|"));
    for (const f of readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test.")))
      expect(readFileSync(path.join(dir, f), "utf8"), f).not.toMatch(banned);
  });
});
