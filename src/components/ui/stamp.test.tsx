import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Stamp as FromIndex } from "@/components/ui";
import { STAMP_ANGLE, Stamp, clampRotation, rotationFromSeed, stampAngle } from "./stamp";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const css = readFileSync(path.join(process.cwd(), "src/components/ui/stamp.module.css"), "utf8");
const tsx = readFileSync(path.join(process.cwd(), "src/components/ui/stamp.tsx"), "utf8");

/** The body of the first `selector { ... }` block of the stylesheet (no nesting inside). */
function block(selector: string, from = css): string {
  const at = from.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return from.slice(at, from.indexOf("}", at) + 1);
}

/** The keyframes block, nested braces included. */
function keyframes(name: string): string {
  const at = css.indexOf(`@keyframes ${name}`);
  expect(at, name).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error(`unterminated @keyframes ${name}`);
}

describe("Stamp markup (#26 C1)", () => {
  it("is exported from the ui index", () => {
    expect(FromIndex).toBe(Stamp);
  });

  it("renders lines[0] in type-display-{sm,md,lg} by size, md by default", () => {
    expect(html(<Stamp lines={["FILED"]} />)).toMatch(/class="type-display-md"[^>]*>FILED</);
    for (const size of ["sm", "md", "lg"] as const) {
      const out = html(<Stamp size={size} lines={["FILED"]} />);
      expect(out, size).toMatch(new RegExp(`class="type-display-${size}"[^>]*>FILED<`));
      expect(out, size).toContain(`data-stamp-size="${size}"`);
    }
  });

  it("renders the optional lines[1] in type-label, nothing when absent", () => {
    const two = html(<Stamp lines={["ОБГОН! · OVERTAKE", "DÉPASSEMENT"]} />);
    expect(two).toMatch(/class="type-label"[^>]*>DÉPASSEMENT</);
    expect(html(<Stamp lines={["FILED"]} />)).not.toContain("type-label");
  });

  it("accepts nodes per line (the <span lang> convention of /design)", () => {
    const out = html(
      <Stamp
        lines={[
          <>
            <span lang="ru">НАЧАЛИ</span> / GO
          </>,
        ]}
      />,
    );
    expect(out).toContain('<span lang="ru">НАЧАЛИ</span> / GO');
  });

  it('is role="status" by default, "alert" on request, and no live region for null', () => {
    expect(html(<Stamp lines={["FILED"]} />)).toMatch(/^<span[^>]*role="status"/);
    expect(html(<Stamp role="alert" lines={["FILED"]} />)).toMatch(/^<span[^>]*role="alert"/);
    const badge = html(<Stamp role={null} lines={["HOST"]} />);
    expect(badge).not.toContain("role=");
  });

  it("marks its tone, red by default, and passes className through", () => {
    expect(html(<Stamp lines={["FILED"]} />)).toContain('data-stamp-tone="red"');
    expect(html(<Stamp tone="ink" lines={["FILED"]} />)).toContain('data-stamp-tone="ink"');
    expect(html(<Stamp className="mt-4" lines={["FILED"]} />)).toMatch(/class="[^"]*mt-4/);
  });

  it("draws a 4px double rule on the color-mix paper ground (bible 7.3, #107)", () => {
    const stamp = block(".stamp");
    expect(stamp).toMatch(/border:\s*4px double/);
    expect(stamp).toContain("background: color-mix(in srgb, var(--color-bg) 90%, transparent)");
  });

  it("tone red = link text on a primary rule; tone ink = fg text and rule", () => {
    const red = block(".red");
    expect(red).toContain("color: var(--color-link)");
    expect(red).toContain("border-color: var(--color-primary)");
    const ink = block(".ink");
    expect(ink).toContain("color: var(--color-fg)");
    expect(ink).toContain("border-color: var(--color-fg)");
  });
});

describe("Stamp rotation (#26 C2)", () => {
  it("keeps -6 to 6 degrees and clamps outside", () => {
    expect(STAMP_ANGLE).toEqual({ min: -6, max: 6, crooked: 2, fallback: -6 });
    for (const a of [-6, -3.5, 0, 4, 6]) expect(clampRotation(a)).toBe(a);
    expect(clampRotation(-8)).toBe(-6);
    expect(clampRotation(-90)).toBe(-6);
    expect(clampRotation(7)).toBe(6);
    expect(clampRotation(360)).toBe(6);
    expect(clampRotation(Number.NaN)).toBe(-6);
  });

  it("auto: the same seed always lands at the same angle, different seeds differ", () => {
    expect(rotationFromSeed("overtake:12")).toBe(rotationFromSeed("overtake:12"));
    expect(rotationFromSeed(42)).toBe(rotationFromSeed(42));
    const seeds = ["a", "b", "c", "overtake:1", "overtake:2", "go", 0, 1, 2, 99];
    const angles = seeds.map(rotationFromSeed);
    expect(new Set(angles).size).toBe(seeds.length);
  });

  it("auto: always a little crooked, 2 <= |angle| <= 6, both directions", () => {
    const angles = Array.from({ length: 500 }, (_, i) => rotationFromSeed(`seed-${i}`));
    for (const a of angles) {
      expect(Math.abs(a)).toBeGreaterThanOrEqual(2);
      expect(Math.abs(a)).toBeLessThanOrEqual(6);
    }
    expect(angles.some((a) => a < 0)).toBe(true);
    expect(angles.some((a) => a > 0)).toBe(true);
  });

  it("drives --stamp-angle inline: the number clamped, auto from the seed", () => {
    expect(stampAngle(3, undefined)).toBe(3);
    expect(stampAngle(12, undefined)).toBe(6);
    expect(stampAngle("auto", "go")).toBe(rotationFromSeed("go"));
    expect(html(<Stamp lines={["FILED"]} />)).toContain("--stamp-angle:-6deg");
    expect(html(<Stamp rotation={-20} lines={["FILED"]} />)).toContain("--stamp-angle:-6deg");
    expect(html(<Stamp rotation={4.5} lines={["FILED"]} />)).toContain("--stamp-angle:4.5deg");
    expect(html(<Stamp rotation="auto" seed="go" lines={["FILED"]} />)).toContain(
      `--stamp-angle:${rotationFromSeed("go")}deg`,
    );
    expect(html(<Stamp rotation={4.5} lines={["FILED"]} />)).toContain('data-stamp-angle="4.5"');
  });
});

describe("Stamp slam (#26 C3, C4, C5)", () => {
  it("slams once with fcSlam on the slam tokens", () => {
    const stamp = block(".stamp");
    expect(stamp).toContain(
      "animation: fcSlam var(--motion-duration-slam) var(--motion-ease-slam) both",
    );
    expect(stamp).toContain("transform: rotate(var(--stamp-angle))");
    expect(css).not.toMatch(/animation-iteration-count/);
  });

  it("keyframes: scale 2.2 -> 0.9 -> 1, rotation from angle - 8deg to angle", () => {
    const k = keyframes("fcSlam");
    expect(k).toMatch(/0%\s*\{[^}]*scale\(2\.2\) rotate\(calc\(var\(--stamp-angle\) - 8deg\)\)/);
    expect(k).toMatch(/60%\s*\{[^}]*scale\(0\.9\)/);
    expect(k).toMatch(/100%\s*\{[^}]*scale\(1\) rotate\(var\(--stamp-angle\)\)/);
  });

  it("C5 opacity changes at most once: 0 then 1, never back (no blink, no repeat)", () => {
    const k = keyframes("fcSlam");
    const values = [...k.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    expect(values).toEqual([0, 1]);
    expect(`${css}\n${tsx}`).not.toMatch(/infinite|blink/);
    expect(css.match(/@keyframes/g)).toHaveLength(1);
  });

  it("C4 stops under both reduce selectors with animation: none, no !important", () => {
    const media = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(media).toMatch(
      /^@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.stamp\s*\{\s*animation: none;/,
    );
    expect(block(':root[data-motion="reduce"] .stamp')).toContain("animation: none");
    expect(css).not.toContain("!important");
  });
});
