import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hudLabelFixtures } from "../view/hud-labels";
import { NIXIE_WPM_MAX, NixieCounters, nixieNumber } from "./nixie-counters";

// Contract of #560 C1 (markup and CSS; the computed glow is checked in e2e/race/hud.spec.ts).
const EN = hudLabelFixtures.en.nixie;
const FR = hudLabelFixtures.fr.nixie;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const css = readFileSync(
  path.join(process.cwd(), "src/features/race/components/nixie-counters.module.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The `data-tube` elements (flat text): their name, attributes and numerals. */
function tubes(markup: string) {
  return [...markup.matchAll(/<span([^>]*)data-tube="(\w+)"([^>]*)>([^<]*)<\/span>/g)].map((m) => ({
    name: m[2],
    attrs: `${m[1]}${m[3]}`,
    text: m[4]!,
  }));
}

/** Every CSS rule as `{ selector, body }` (flat: the module has no nesting). */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1]!.trim(),
  body: m[2]!,
}));

describe("NixieCounters (#560 C1)", () => {
  it("renders two tubes, WPM and place, with the numerals zero-padded to two digits", () => {
    const out = tubes(html(<NixieCounters wpm={42} place={4} total={30} labels={EN} />));
    expect(out.map((t) => t.name)).toEqual(["wpm", "place"]);
    expect(out[0]!.text).toBe("42");
    expect(out[1]!.text).toBe("04 / 30");
    const early = tubes(html(<NixieCounters wpm={7} place={1} total={6} labels={EN} />));
    expect(early.map((t) => t.text)).toEqual(["07", "01 / 06"]);
  });

  it("before the start the place reads 00 / total", () => {
    const out = tubes(html(<NixieCounters wpm={0} place={null} total={30} labels={EN} />));
    expect(out.map((t) => t.text)).toEqual(["00", "00 / 30"]);
  });

  it("caps WPM at 999 and keeps three-digit numbers whole", () => {
    expect(NIXIE_WPM_MAX).toBe(999);
    expect(nixieNumber(1234, NIXIE_WPM_MAX)).toBe("999");
    expect(nixieNumber(120, NIXIE_WPM_MAX)).toBe("120");
    expect(nixieNumber(41.6, NIXIE_WPM_MAX)).toBe("42");
    expect(nixieNumber(-3, NIXIE_WPM_MAX)).toBe("00");
    expect(nixieNumber(Number.NaN, NIXIE_WPM_MAX)).toBe("00");
    const out = tubes(html(<NixieCounters wpm={1500} place={2} total={100} labels={EN} />));
    expect(out.map((t) => t.text)).toEqual(["999", "02 / 100"]);
  });

  it("numerals are the type-device role (VT323) inside the tubes", () => {
    for (const t of tubes(html(<NixieCounters wpm={42} place={4} total={30} labels={EN} />))) {
      expect(t.attrs, t.name).toContain("type-device");
    }
  });

  it("names the counters in words, in the label language; the glyphs are hidden", () => {
    const out = html(<NixieCounters wpm={42} place={4} total={30} labels={EN} />);
    expect(out).toMatch(
      /^<div[^>]*role="group"[^>]*aria-label="Words per minute 42, place 4 of 30"/,
    );
    expect(out).toContain('aria-hidden="true"');
    const fr = html(<NixieCounters wpm={42} place={4} total={30} labels={FR} />);
    expect(fr).toContain('aria-label="Mots par minute 42, rang 4 sur 30"');
    expect(fr).toContain(">MPM<");
    expect(fr).toContain(">RANG<");
    const before = html(<NixieCounters wpm={0} place={null} total={30} labels={EN} />);
    expect(before).toContain('aria-label="Words per minute 0, 30 typists, no place yet"');
  });

  it("is a device bezel: data-device on the root, the nixie glow class only on the tubes", () => {
    const out = html(<NixieCounters wpm={42} place={4} total={30} labels={EN} />);
    expect(out).toMatch(/^<div[^>]*data-device="nixie"/);
    const glowing = [...out.matchAll(/<[a-z]+[^>]*class="[^"]*\bdevice-nixie\b[^"]*"[^>]*>/g)];
    expect(glowing).toHaveLength(2);
    for (const m of glowing) expect(m[0]).toContain("data-tube");
    expect(out).not.toContain("device-phosphor");
  });

  it("the glow (text-shadow, box-shadow) is declared only on the tube rule", () => {
    const glow = rules.filter((r) => /(text|box)-shadow\s*:/.test(r.body));
    expect(glow.map((r) => r.selector)).toEqual([".tube"]);
    const tube = glow[0]!.body;
    expect(tube).toMatch(/box-shadow:\s*inset 0 0 \d+px var\(--color-device-nixie-glow\)/);
    // the numerals' own glow is the scoped device-nixie utility (tokens.css), never a second recipe
    expect(tube).not.toMatch(/text-shadow/);
  });
});
