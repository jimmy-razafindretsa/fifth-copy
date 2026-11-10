import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import type { PersonalStats } from "../view/personal";
import { personalLabels } from "../view/report-labels";
import { formatRaceTime, graphGeometry, type RaceSeries } from "../view/series";
import { PersonalCard } from "./personal-card";
import { RaceGraph } from "./race-graph";

// Contract of #865 C3: the series as inline SVG, an ink polyline on paper with the WPM scale and the
// race time, a red tick with the bonus name at each mark; role="img" named by one sentence (peak WPM,
// final WPM, bonuses received); no animation; null reads NO TRACE ON FILE / AUCUNE TRACE AU DOSSIER.
const EN = personalLabels(en);
const FR = personalLabels(fr);

const SERIES: RaceSeries = {
  points: [
    { t: 10_000, wpm: 38.2 },
    { t: 20_000, wpm: 52.6 },
    { t: 30_000, wpm: 44.1 },
    { t: 40_000, wpm: 47.8 },
  ],
  marks: [
    { t: 21_000, kind: "smoke-break" },
    { t: 30_000, kind: "extra-paperwork" },
  ],
  endMs: 40_000,
};

const render = (series: RaceSeries | null, labels = EN) =>
  renderToStaticMarkup(<RaceGraph series={series} labels={labels} />);
const css = readFileSync(join(__dirname, "race-graph.module.css"), "utf8");

describe("RaceGraph (#865 C3)", () => {
  it("one inline SVG image named by peak, final and bonuses received", () => {
    const html = render(SERIES);
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Peak 53 WPM, final 48 WPM, 2 bonuses received."');
    expect(render(SERIES, FR)).toContain(
      'aria-label="Pointe à 53 MPM, arrivée à 48 MPM, 2 bonus reçus."',
    );
    const one = { ...SERIES, marks: SERIES.marks.slice(0, 1) };
    expect(render(one)).toContain("1 bonus received.");
    expect(render(one, FR)).toContain("1 bonus reçu.");
    const none = { ...SERIES, marks: [] };
    expect(render(none)).toContain("0 bonuses received.");
    expect(render(none, FR)).toContain("0 bonus reçu.");
    expect(render(none)).not.toContain("<ol");
  });

  it("an ink polyline through every point from GO, on the WPM scale and the race time", () => {
    const html = render(SERIES);
    const g = graphGeometry(SERIES);
    expect(g.yMax).toBe(60);
    // GO at 0 WPM, then each point: x is time over the race, y the WPM over the scale's top
    expect(g.line).toBe("0,100 250,36.3 500,12.3 750,26.5 1000,20.3");
    expect(html).toContain(`points="${g.line}"`);
    expect(html).toContain('data-scale="top">60<');
    expect(html).toContain('data-scale="bottom">0<');
    expect(html).toContain(">0:00<");
    expect(html).toContain('data-time="end">0:40<');
    expect(formatRaceTime(125_400)).toBe("2:05");
    expect(css).toMatch(/\.line \{[^}]*stroke: var\(--color-fg\)/);
    expect(css).toMatch(/\.plot \{[^}]*background: var\(--color-bg\)/);
  });

  it("a red tick with the bonus name at each mark, in time order", () => {
    const html = render(SERIES);
    expect(html.match(/data-mark="/g)).toHaveLength(2);
    expect(html).toContain('x1="525" x2="525"'); // 21 s of 40 s
    expect(html).toContain('data-mark="extra-paperwork"');
    const names = [...html.matchAll(/data-kind="([^"]+)"><span[^>]*>([^<]+)</g)].map((m) => m[2]);
    expect(names).toEqual(["SMOKE BREAK", "EXTRA PAPERWORK"]);
    expect(render(SERIES, FR)).toContain("PAUSE CIGARETTE");
    expect(css).toMatch(/\.tick \{[^}]*stroke: var\(--color-link\)/);
    expect(css).toMatch(/\.nameText \{[^}]*color: var\(--color-link\)/);
  });

  it("no animation and no gold", () => {
    expect(css).not.toMatch(/animation|transition|@keyframes/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/reward|gold|medal/i);
    expect(render(SERIES)).not.toMatch(/<animate|gold|reward/i);
  });

  it("null reads NO TRACE ON FILE / AUCUNE TRACE AU DOSSIER, no image", () => {
    expect(render(null)).toContain(">NO TRACE ON FILE<");
    expect(render(null, FR)).toContain(">AUCUNE TRACE AU DOSSIER<");
    expect(render(null)).not.toContain("<svg");
  });

  it("the card adds the graph section under the bonuses only when given a series", () => {
    const stats: PersonalStats = {
      desk: 12,
      place: 3,
      wpm: 47.8,
      accuracy: 0.92,
      status: "FINISHED",
      suspicious: false,
      bonuses: { sent: [], received: [] },
    };
    const card = (series?: RaceSeries | null) =>
      renderToStaticMarkup(<PersonalCard stats={stats} labels={EN} series={series} />);
    expect(card()).not.toContain('data-section="graph"');
    expect(card(null)).toContain("NO TRACE ON FILE");
    const html = card(SERIES);
    expect(html.indexOf('data-section="graph"')).toBeGreaterThan(
      html.indexOf('data-section="bonuses"'),
    );
    // the card's h2 tag, then the graph's h3: headings in order
    expect(html).toMatch(/<h2[^>]*>FORM 5-R · YOUR COPY<\/h2>[\s\S]*<h3[^>]*>WPM THROUGH THE RACE<\/h3>/);
  });
});
