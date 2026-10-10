import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hudLabelFixtures } from "../view/hud-labels";
import { type RaceCardView, raceCardViewFixtures as F } from "../view/race-card-view";
import { RaceCard } from "./race-card";

// Contract of #560 C2 and C3 (markup and CSS; computed colours and the compact box in e2e/race/hud.spec.ts).
const EN = hudLabelFixtures.en.raceCard;
const FR = hudLabelFixtures.fr.raceCard;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const css = readFileSync(
  path.join(process.cwd(), "src/features/race/components/race-card.module.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

/** The opening tags carrying `attr`, in document order. */
const tags = (markup: string, attr: string) =>
  [...markup.matchAll(new RegExp(`<[a-z]+[^>]*\\b${attr}\\b[^>]*>`, "g"))].map((m) => m[0]);

/** The inner markup of each lane `<li>`. */
const lanes = (markup: string) =>
  [...markup.matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/g)].map((m) => ({ attrs: m[1]!, body: m[2]! }));

/** The body of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const m = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((r) => r[1]!.trim() === selector);
  expect(m, selector).toBeDefined();
  return m![2]!;
}

describe("RaceCard full-field line (#560 C2)", () => {
  it("has one tick per field entry, positioned by progress (0..1, clamped)", () => {
    for (const name of ["six-mid-field", "thirty-mid-field"] as const) {
      const view = F[name];
      const ticks = tags(html(<RaceCard view={view} labels={EN} />), "data-tick");
      expect(ticks, name).toHaveLength(view.field.length);
      view.field.forEach((t, i) => {
        expect(ticks[i], name).toContain(`data-desk="${t.desk}"`);
        expect(ticks[i], name).toContain(`--_p:${t.progress}`);
      });
    }
    const wild: RaceCardView = {
      field: [
        { desk: 1, progress: 1.4, you: false },
        { desk: 2, progress: -0.2, you: true },
      ],
      lanes: [],
    };
    const ticks = tags(html(<RaceCard view={wild} labels={EN} />), "data-tick");
    expect(ticks[0]).toContain("--_p:1");
    expect(ticks[1]).toContain("--_p:0");
  });

  it("marks your tick (the only one) and paints it agit-red with an ink edge", () => {
    const ticks = tags(html(<RaceCard view={F["thirty-mid-field"]} labels={EN} />), "data-tick");
    expect(ticks.filter((t) => t.includes("data-you"))).toHaveLength(1);
    expect(ticks.find((t) => t.includes("data-you"))).toContain('data-desk="17"');
    const you = rule('.tick[data-you="true"]');
    expect(you).toMatch(/background:\s*var\(--color-you\)/);
    // Night shift: agit-red is 1.76:1 on the night ground, the fg edge carries the mark (bible 7.4a)
    expect(you).toMatch(/border:\s*1px solid var\(--color-fg\)/);
    expect(rule(".tick")).toMatch(/background:\s*var\(--color-rival\)/);
  });

  it("ends in a checkered finish: a hard-edged repeating gradient of the finish tokens, no blur", () => {
    const out = html(<RaceCard view={F["six-leading"]} labels={EN} />);
    expect(tags(out, "data-finish")).toHaveLength(1);
    const finish = rule(".finish");
    expect(finish).toMatch(
      /repeating-conic-gradient\(\s*var\(--color-finish-ink\) 0 25%,\s*var\(--color-finish-paper\) 0 50%\s*\)/,
    );
    expect(finish).not.toMatch(/blur|shadow/);
  });

  it("names the field line in words with your progress", () => {
    const out = unescape(html(<RaceCard view={F["six-mid-field"]} labels={EN} />));
    expect(out).toContain('role="img" aria-label="6 typists on the line, you at 41%"');
  });
});

describe("RaceCard lanes (#560 C2)", () => {
  it("renders one lane per view lane, in order, with the desk number as paperwork", () => {
    const view = F["thirty-mid-field"];
    const out = lanes(html(<RaceCard view={view} labels={EN} />));
    expect(out).toHaveLength(view.lanes.length);
    view.lanes.forEach((lane, i) => {
      expect(out[i]!.attrs).toContain(`data-desk="${lane.desk}"`);
      expect(out[i]!.body).toContain(`DESK ${String(lane.desk).padStart(2, "0")}`);
      expect(out[i]!.body).toContain(lane.name);
    });
    expect(html(<RaceCard view={view} labels={FR} />)).toContain("BUREAU 07");
  });

  it("draws each marker shape as inline SVG: circle, square, triangle, diamond", () => {
    const out = lanes(html(<RaceCard view={F["six-mid-field"]} labels={EN} />));
    const shapes = new Set<string>();
    for (const lane of out) {
      const svg = /<svg[^>]*data-marker="(\w+)"[^>]*>([\s\S]*?)<\/svg>/.exec(lane.body);
      expect(svg, lane.attrs).not.toBeNull();
      expect(svg![0]).toContain('aria-hidden="true"');
      shapes.add(svg![1]!);
      const body = svg![2]!;
      if (svg![1] === "circle") expect(body).toMatch(/^<circle /);
      if (svg![1] === "square") expect(body).toMatch(/^<rect /);
      if (svg![1] === "triangle") expect(body).toMatch(/^<polygon points="[^"]+"/);
      if (svg![1] === "diamond") expect(body).toMatch(/^<polygon points="[^"]+"/);
    }
    expect([...shapes].sort()).toEqual(["circle", "diamond", "square", "triangle"]);
  });

  it("shows the status label for line-cut, asleep, abandoned and finished, none while typing", () => {
    const out = lanes(html(<RaceCard view={F["six-statuses"]} labels={EN} />));
    const statusOf = (body: string) => /data-status-label="[\w-]+"[^>]*>([^<]*)</.exec(body)?.[1];
    const byStatus = Object.fromEntries(
      F["six-statuses"].lanes.map((l, i) => [l.status + l.desk, statusOf(out[i]!.body)]),
    );
    expect(byStatus).toEqual({
      finished1: "FILED",
      "line-cut2": "LINE CUT",
      typing3: undefined,
      typing5: undefined,
      asleep4: "ASLEEP AT DESK",
      abandoned6: "REASSIGNED",
    });
    const fr = html(<RaceCard view={F["six-statuses"]} labels={FR} />);
    for (const label of ["CLASSÉ", "LIGNE COUPÉE", "ENDORMI AU BUREAU", "RÉAFFECTÉ"]) {
      expect(fr).toContain(label);
    }
  });

  it("your lane is red (marker, name) with the YOU tag; rivals take their marker ink", () => {
    const out = lanes(html(<RaceCard view={F["six-mid-field"]} labels={EN} />));
    const you = out.filter((l) => l.attrs.includes("data-you"));
    expect(you).toHaveLength(1);
    expect(you[0]!.body).toContain(">YOU<");
    for (const rival of out.filter((l) => !l.attrs.includes("data-you"))) {
      expect(rival.attrs).toContain('data-ink="rival"');
    }
    expect(rule('[data-ink="rival"]')).toMatch(/--_ink:\s*var\(--color-rival\)/);
    expect(rule('[data-you="true"]')).toMatch(/--_ink:\s*var\(--color-you\)/);
    expect(rule(".marker")).toMatch(/fill:\s*var\(--_ink\)/);
    expect(rule('[data-you="true"] .name')).toMatch(/color:\s*var\(--color-link\)/);
  });

  it("each lane reads in words and rides its marker along a track by progress", () => {
    const view = F["six-statuses"];
    const out = lanes(unescape(html(<RaceCard view={view} labels={EN} />)));
    expect(out[1]!.attrs).toContain(
      'aria-label="Place 2, Badger-374, desk 02, 71% typed, LINE CUT"',
    );
    expect(out[2]!.attrs).toContain('aria-label="Place 3, Heron-511, desk 03, 58% typed"');
    view.lanes.forEach((lane, i) => {
      expect(out[i]!.body).toMatch(new RegExp(`data-rider[^>]*--_p:${lane.progress}`));
    });
  });
});

describe("RaceCard compact (#560 C3)", () => {
  it("hides the names and keeps markers, desk numbers and the field line", () => {
    const view = F["thirty-mid-field"];
    const full = html(<RaceCard view={view} labels={EN} />);
    const compact = html(<RaceCard view={view} labels={EN} compact />);
    expect(compact).toMatch(/^<section[^>]*data-compact="true"/);
    expect(full).not.toContain("data-compact");
    for (const lane of lanes(compact)) {
      // names stay for assistive tech in the lane's label, never as visible text
      expect(lane.body).not.toMatch(/data-name/);
      expect(lane.body).toMatch(/<svg[^>]*data-marker=/);
      expect(lane.body).toMatch(/DESK \d\d/);
    }
    for (const lane of lanes(full)) expect(lane.body).toMatch(/data-name/);
    expect(tags(compact, "data-tick")).toHaveLength(view.field.length);
    expect(tags(compact, "data-finish")).toHaveLength(1);
    expect(rule('[data-compact="true"] .lane')).toMatch(/grid-template-columns:/);
  });
});
