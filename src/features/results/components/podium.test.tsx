import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { placeSlots, type ReportEntry } from "../view/dawn-report";
import { dawnReportFixtures } from "../view/dawn-report-fixtures";
import { podiumLabels } from "../view/report-labels";
import { Podium } from "./podium";

// The fixtures read identity's barrel (outfitForDesk), server code that validates the env on import.
vi.mock("@/env", () => ({ env: {} }));

// Contract of #300 C3: the podium renders at most three plinths from places 1-3 (DOM in place order,
// CSS 2 | 1 | 3), each with the medal slot, `DESK nn · name`, clean WPM and `97 %`; UNFILLED, TIED,
// UNDER REVIEW and the viewer's YOU tag. Rendered to static markup and read back with a DOM-free parser.
const EN = podiumLabels(en.results);
const FR = podiumLabels(fr.results);

function render(entries: ReportEntry[], viewerDesk: number | null = null, labels = EN) {
  return renderToStaticMarkup(
    <Podium entries={entries} viewerDesk={viewerDesk} labels={labels} medals="still" />,
  );
}

/** The markup of each plinth, keyed by place. */
function plinths(html: string): Map<number, string> {
  const out = new Map<number, string>();
  const parts = html.split(/<li class="[^"]*" data-plinth="/).slice(1);
  for (const part of parts) out.set(Number(part[0]), part);
  return out;
}
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'");

const full = dawnReportFixtures.full.entries;

describe("Podium (#300 C3)", () => {
  it("renders three plinths in place order from the six-desk race", () => {
    const html = render(full);
    expect(html).toMatch(/^<ol [^>]*aria-label="Podium"/);
    expect([...plinths(html).keys()]).toEqual([1, 2, 3]);
    expect(html.match(/data-plinth=/g)).toHaveLength(3);
  });

  it("each plinth: medal slot, № n, DESK nn · name, clean WPM, accuracy as 97 %", () => {
    const first = plinths(render(full)).get(1)!;
    expect(first).toContain("data-medal-slot");
    expect(first).toContain('data-medal="gold"');
    expect(text(first)).toContain("№ 1");
    expect(text(first)).toContain("DESK 07 · Lynx-785");
    expect(text(first)).toContain("61WPM");
    expect(text(first)).toContain("97 %ACCURACY");
    expect(plinths(render(full)).get(2)).toContain('data-medal="silver"');
    expect(plinths(render(full)).get(3)).toContain('data-medal="bronze"');
  });

  it("tags the bot (BOT) and only the bot", () => {
    const p = plinths(render(full));
    expect(text(p.get(2)!)).toContain("Typist Bot 2BOT");
    expect(text(p.get(1)!)).not.toContain("BOT");
  });

  it("a missing place renders an UNFILLED plinth (two finishers)", () => {
    const p = plinths(render(dawnReportFixtures["two-finishers"].entries));
    expect(p.size).toBe(3);
    expect(p.get(3)).toMatch(/^3" data-unfilled="true"/);
    expect(text(p.get(3)!)).toContain("UNFILLED");
    expect(p.get(3)).not.toContain("data-medal=");
    expect(
      text(plinths(render(dawnReportFixtures["two-finishers"].entries, null, FR)).get(3)!),
    ).toContain("NON POURVU");
  });

  it("entries sharing a place share one TIED plinth; places 1, 1, 3 leave the second unfilled", () => {
    const entries = dawnReportFixtures.tie.entries;
    expect(placeSlots(entries).map((s) => s.entries.length)).toEqual([2, 0, 1]);
    const p = plinths(render(entries));
    expect(p.get(1)).toContain('data-tied="true"');
    expect(text(p.get(1)!)).toContain("TIED");
    expect(p.get(1)!.match(/data-desk=/g)).toHaveLength(2);
    expect(p.get(1)!.match(/data-medal=/g)).toHaveLength(1);
    expect(text(p.get(2)!)).toContain("UNFILLED");
    expect(text(plinths(render(entries, null, FR)).get(1)!)).toContain("EX AEQUO");
  });

  it("a suspicious entry shows UNDER REVIEW in the medal slot and keeps its figures", () => {
    const p = plinths(render(dawnReportFixtures["under-review"].entries));
    expect(p.get(1)).toContain('data-under-review="true"');
    expect(p.get(1)).not.toContain("data-medal=");
    expect(text(p.get(1)!)).toContain("UNDER REVIEW");
    expect(text(p.get(1)!)).toContain("118WPM");
    const frp = plinths(render(dawnReportFixtures["under-review"].entries, null, FR));
    expect(text(frp.get(1)!)).toContain("EN VÉRIFICATION");
  });

  it("the viewer's plinth carries the YOU tag, no other does", () => {
    const p = plinths(render(full, 12));
    expect(p.get(3)).toContain('data-you="true"');
    expect(text(p.get(3)!)).toContain("Heron-302YOU");
    expect(text(p.get(1)!)).not.toContain("YOU");
    expect(render(full, 5)).not.toContain("data-you");
    expect(text(render(full, 12, FR))).toContain("TOI");
  });

  it("shows a status tag for a podium desk that did not file (one language per block)", () => {
    const entries = [{ ...full[0]!, status: "TIMED_OUT" as const }];
    expect(text(render(entries))).toContain("TIMED OUT");
    expect(text(render(entries, null, FR))).toContain("TEMPS ÉCOULÉ");
    expect(text(render(entries, null, FR))).toContain("BUREAU 07");
    expect(text(render(entries, null, FR))).toContain("MPM");
  });

  it("never shows a place beyond 3 (the LINE_CUT desk 4 and the suspicious desk 6 stay off)", () => {
    const html = render(full);
    expect(html).not.toContain('data-desk="5"');
    expect(html).not.toContain('data-desk="2"');
  });
});

// Contract of #688 C3-C4: each filled plinth holds its player's clerk frame (live) with the place's medal
// and outfit in its URL once mounted; the frames are idle in the server markup (the stagger mounts them
// one at a time on the client); UNFILLED and UNDER REVIEW slots hold no frame; a tie shows one clerk.
function live(entries: ReportEntry[]) {
  return renderToStaticMarkup(<Podium entries={entries} viewerDesk={null} labels={EN} />);
}

describe("Podium clerks (#688 C3, C4)", () => {
  it("live: three idle clerk frames in place order with their medal titles, no stamp", () => {
    const p = plinths(live(full));
    for (const [place, variant] of [
      [1, "gold"],
      [2, "silver"],
      [3, "bronze"],
    ] as const) {
      expect(p.get(place)).toContain('data-medal-view="frame"');
      expect(p.get(place)).toContain(`data-medal="${variant}"`);
      expect(p.get(place)).toContain('data-embed="idle"');
      expect(p.get(place)).toContain(`title="${EN.medalTitle[variant]}"`);
    }
    expect(live(full)).not.toMatch(/<iframe[^>]* src=/);
  });

  it("still (/design): the stamps, never a frame", () => {
    expect(render(full)).not.toContain("<iframe");
    expect(render(full).match(/data-medal-view="stamp"/g)).toHaveLength(3);
  });

  it("UNFILLED and UNDER REVIEW slots hold no clerk; a tie shows one", () => {
    expect(plinths(live(dawnReportFixtures["two-finishers"].entries)).get(3)).not.toContain(
      "<iframe",
    );
    expect(plinths(live(dawnReportFixtures["under-review"].entries)).get(1)).not.toContain(
      "<iframe",
    );
    expect(
      plinths(live(dawnReportFixtures.tie.entries))
        .get(1)!
        .match(/<iframe/g),
    ).toHaveLength(1);
  });

  it("the plinths pass their place, medal and wearer's outfit (a tie: the first tied entry)", () => {
    const source = readFileSync(path.join(__dirname, "podium.tsx"), "utf8");
    expect(source).toContain("const wearer = entries[0];");
    expect(source).toContain("outfit={wearer.outfit}");
    expect(source).toContain("<PlinthMounts slots={frames}>");
    expect(source).toContain("entries.length > 0 && !entries.some((e) => e.suspicious)");
  });
});
