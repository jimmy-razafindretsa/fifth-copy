import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { layouts, numberRows } from "@/features/identity";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { heatmapOf } from "../view/heatmap";
import { personalLabels } from "../view/report-labels";
import { coachingFrom } from "../view/tip";
import type { PersonalStats } from "../view/personal";
import { PersonalCard } from "./personal-card";
import { ReportHeatmap } from "./report-heatmap";

// The report links reach src/env.ts through the identity index (#899); these tests need no secrets.
vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

// #999 C54: the Dawn report's compact keyboard heatmap (bible 14.3: paper, gold, red) from the viewer's
// own key tallies, on their layout; one image named by the missed keys; between the errors and the tip.
const EN = personalLabels(en);
const FR = personalLabels(fr);
const US = { number: numberRows.US_QWERTY, letters: layouts.US_QWERTY };
const TALLIES = [
  { char: "t", attempts: 12, errors: 4 },
  { char: "T", attempts: 2, errors: 0 },
  { char: "e", attempts: 20, errors: 2 },
  { char: " ", attempts: 9, errors: 1 },
  { char: "h", attempts: 6, errors: 0 },
  { char: "é", attempts: 1, errors: 1 }, // no key on US QWERTY: left to the errors list
];
const css = readFileSync(join(__dirname, "report-heatmap.module.css"), "utf8");

describe("heatmapOf (#999 C54)", () => {
  it("folds capitals onto their key, heat over the most missed key, untyped otherwise", () => {
    const map = heatmapOf(TALLIES, US);
    const key = (c: string) =>
      [...map.rows.flatMap((r) => r.keys), map.space].find((k) => k.char === c)!;
    expect(key("t")).toMatchObject({ cap: "T", attempts: 14, errors: 4, state: "missed", heat: 1 });
    expect(key("e")).toMatchObject({ state: "missed", heat: 0.5 });
    expect(key(" ")).toMatchObject({ state: "missed", heat: 0.25 });
    expect(key("h")).toMatchObject({ state: "clean", heat: 0 });
    expect(key("q")).toMatchObject({ state: "untyped", heat: 0 });
    expect(map.missed.map((k) => k.char)).toEqual(["t", "e", " "]);
    expect(map.rows.map((r) => r.keys.length)).toEqual([13, 13, 11, 10]);
    expect(map.unit).toBeCloseTo(100 / 14.5, 6); // the 13-key top row is 14.5 units wide
  });
});

describe("ReportHeatmap (#999 C54)", () => {
  const render = (labels = EN, tallies = TALLIES) =>
    renderToStaticMarkup(
      <ReportHeatmap map={heatmapOf(tallies, US)} layout="US_QWERTY" labels={labels} />,
    );

  it("one image named by its missed keys, in both languages", () => {
    expect(render()).toContain(">KEYBOARD HEATMAP<");
    expect(render()).toContain(
      'role="img" aria-label="Keyboard heatmap, US QWERTY: T × 4, E × 2, SPACE × 1."',
    );
    expect(render(FR)).toContain(">CARTE DES FAUTES<");
    expect(render(FR)).toContain(
      'aria-label="Carte des fautes, QWERTY AMÉRICAIN : T × 4, E × 2, ESPACE × 1."',
    );
    const clean = [{ char: "a", attempts: 3, errors: 0 }];
    expect(render(EN, clean)).toContain(
      'aria-label="Keyboard heatmap, US QWERTY: no error on the keyboard."',
    );
  });

  it("paper for clean, newsprint for untyped, a gold to red band on a missed key", () => {
    const html = render();
    expect(html).toMatch(
      /data-key="t" data-state="missed" data-errors="4"[^>]*>.*?class="[^"]*heat/,
    );
    expect(html).toContain('data-key="h" data-state="clean" data-errors="0"');
    expect(html).toContain('data-key="q" data-state="untyped"');
    expect(html).toContain("--heat:1");
    expect(html).toContain("--heat:0.5");
    expect(css).toMatch(/\.key \{[^}]*background: var\(--color-bg\)/);
    expect(css).toMatch(/\.key\[data-state="untyped"\] \{[^}]*var\(--color-surface\)/);
    expect(css).toMatch(/\.heat \{[^}]*var\(--color-primary\)[^}]*var\(--color-reward\)/);
    expect(css).not.toMatch(/animation|transition|@keyframes/);
    expect(html).toContain(">paper: no error<");
    expect(html).toContain(">gold to red: fewer to more errors<");
  });

  it("sits in the card between the errors by key and the tip", () => {
    const stats: PersonalStats = {
      desk: 12,
      place: 3,
      wpm: 47.8,
      accuracy: 0.92,
      status: "FINISHED",
      suspicious: false,
      bonuses: { sent: [], received: [] },
    };
    const coaching = coachingFrom({ accuracy: 0.92, missed: [{ char: "t", count: 4 }] });
    const html = renderToStaticMarkup(
      <PersonalCard
        stats={stats}
        labels={EN}
        coaching={coaching}
        heatmap={{ map: heatmapOf(TALLIES, US), layout: "US_QWERTY" }}
      />,
    );
    const keys = html.indexOf('data-section="keys"');
    const heat = html.indexOf('data-section="heatmap"');
    const tip = html.indexOf('data-section="tip"');
    expect(keys).toBeGreaterThan(-1);
    expect(heat).toBeGreaterThan(keys);
    expect(tip).toBeGreaterThan(heat);
    const none = renderToStaticMarkup(
      <PersonalCard stats={stats} labels={EN} coaching={coaching} heatmap={null} />,
    );
    expect(none).not.toContain('data-section="heatmap"');
  });
});
