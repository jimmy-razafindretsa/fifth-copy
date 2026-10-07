/**
 * Pure readers over the seven brand vectors of public/brand/ (#11) and the Assets table of
 * docs/design/logo.md (#14). Shared by src/components/ui/brand/assets.test.ts (the asset contract) and
 * scripts/brand/embed-logo.ts (the generator of src/components/ui/brand/assets.ts, #24), so the facts are
 * parsed one way only.
 */

export type Point = [number, number];
export type Bar = [Point, Point, Point, Point, Point];

export function viewBox(svg: string): number[] {
  const m = svg.match(/<svg\b[^>]*\sviewBox="([^"]+)"/);
  if (!m?.[1]) throw new Error("no viewBox");
  return m[1].trim().split(/\s+/).map(Number);
}

/** Every `<path>` in document order: its fill (as written) and its `d`, byte for byte. */
export function paths(svg: string): { fill: string; d: string }[] {
  return [...svg.matchAll(/<path\b([^>]*)\/?>/g)].map((m) => {
    const attrs = m[1] ?? "";
    const fill = attrs.match(/\sfill="([^"]+)"/)?.[1];
    const d = attrs.match(/\sd="([^"]+)"/)?.[1];
    if (!fill || !d) throw new Error("path without fill or d");
    return { fill, d };
  });
}

/** The bar: the only path whose d is a closed 5-point polygon `M x y L x y L x y L x y L x y`. */
export function bar(svg: string): Bar {
  const num = String.raw`(-?[\d.]+) (-?[\d.]+)`;
  const shape = new RegExp(String.raw`^M${num}(?:L${num}){4}$`);
  const bars = [...svg.matchAll(/\sd="([^"]+)"/g)]
    .map((m) => m[1] ?? "")
    .filter((d) => shape.test(d));
  if (bars.length !== 1) throw new Error(`expected one bar polygon, found ${bars.length}`);
  return [...bars.join("").matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]) as Bar;
}

/** Bar height = length of the bar's vertical right edge (points 2 to 3), in viewBox units. */
export const barHeight = ([, b, c]: Bar) => Math.abs(c[1] - b[1]);
/** Slant of the bar's bottom-left to top-right edge (points 1 to 2), degrees, positive = up. */
export const barAngle = ([a, b]: Bar) => (Math.atan2(a[1] - b[1], b[0] - a[0]) * 180) / Math.PI;

export type AssetRow = { file: string; viewBox: number[]; barHeight: number };

/** The Assets table of docs/design/logo.md: `section` is empty and `rows` too when it is missing. */
export function assetsTable(guide: string) {
  const section = guide.split(/^## /m).find((s) => s.startsWith("Assets")) ?? "";
  const table = section
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .map((l) => l.split("|").map((c) => c.trim().replace(/`/g, "")));
  const header = (table[0] ?? []).map((c) => c.toLowerCase());
  const col = (name: string) => header.findIndex((c) => c.startsWith(name));
  const rows: AssetRow[] = table
    .filter((r) => r.some((c) => c.includes("public/brand/")))
    .map((r) => ({
      file: r[col("file")] ?? "",
      viewBox: (r[col("viewbox")] ?? "").split(/\s+/).map(Number),
      barHeight: Number(r[col("bar height")]),
    }));
  return { section, col, rows };
}
