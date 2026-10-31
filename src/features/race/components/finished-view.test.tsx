import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import type { StandingRow } from "../view/standings";
import { FinishedView, type FinishedViewProps } from "./finished-view";

// #240 C2 and C3 at unit level: the one FinishedView docket (bible 7.4). Finished while the race runs:
// tag FILED, your provisional place `01 / 02`, the live standings. Ended: tag RACE OVER, the reason, the
// final standings and the DAWN REPORT ink link to /results/<raceId>. The live wiring is e2e/race/finish.

const rows: StandingRow[] = [
  { place: 1, desk: 2, name: "Otter-202", you: true, value: "100 %", status: "FILED" },
  { place: 2, desk: 1, name: "Lynx-101", you: false, value: "41 %", status: null },
];
const html = (props: Partial<FinishedViewProps>) =>
  renderToStaticMarkup(
    <FinishedView
      mode="finished"
      value="01 / 02"
      rows={rows}
      report={null}
      labels={en.race.finish}
      {...props}
    />,
  );

describe("FinishedView (#240 C2 C3)", () => {
  it("finished: one 7.4 docket tagged FILED with the provisional place, named for assistive tech", () => {
    const out = html({});
    expect(out).toMatch(/^<section[^>]*aria-label="FILED"[^>]*data-finished="finished"/);
    expect(out).toContain(">FILED<");
    expect(out).toContain(">01 / 02<");
    expect(out).not.toContain("<a ");
  });

  it("lists every row in order: place, DESK nn, the name as text, YOU on your row, the figure, the status", () => {
    const out = html({});
    expect(out).toContain('<ol aria-label="Standings"');
    const items = [...out.matchAll(/<li[^>]*data-desk="(\d+)"[^>]*>(.*?)<\/li>/g)];
    expect(items.map((m) => m[1])).toEqual(["2", "1"]);
    expect(items[0]![0]).toContain('data-you="true"');
    expect(items[0]![2]).toContain(">01<");
    expect(items[0]![2]).toContain(">DESK 02<");
    expect(items[0]![2]).toContain(">Otter-202<");
    expect(items[0]![2]).toContain(">YOU<");
    expect(items[0]![2]).toContain(">100 %<");
    expect(items[0]![2]).toContain(">FILED<");
    expect(items[1]![2]).not.toContain(">YOU<");
    expect(items[1]![2]).not.toContain("data-status");
  });

  it("names are text nodes only", () => {
    const out = html({
      rows: [{ ...rows[0]!, name: '<img src=x onerror="alert(1)">' }],
    });
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("ended: tag RACE OVER, the reason, and the DAWN REPORT ink link to the results route", () => {
    const out = html({
      mode: "ended",
      value: en.race.finish.reason.timer,
      report: "/results/3b241101-e2bb-4255-8caf-4136c566a962",
    });
    expect(out).toMatch(/^<section[^>]*aria-label="RACE OVER"[^>]*data-finished="ended"/);
    expect(out).toContain(">TIME&#x27;S UP<");
    expect(out).toMatch(
      /<a[^>]*href="\/results\/3b241101-e2bb-4255-8caf-4136c566a962"[^>]*>DAWN REPORT →<\/a>/,
    );
  });

  it("ended with nothing known (a reload after the end, or no finisher): the header and the link still show", () => {
    const out = html({ mode: "ended", value: null, rows: [], report: "/results/abc" });
    expect(out).toContain(">RACE OVER<");
    expect(out).toContain(">DAWN REPORT →<");
    expect(out).not.toContain("<ol");
  });

  it("French: CLASSÉ, COURSE TERMINÉE, TEMPS ÉCOULÉ, RAPPORT DE L'AUBE →", () => {
    expect(html({ labels: fr.race.finish })).toContain(">CLASSÉ<");
    const out = html({
      mode: "ended",
      value: fr.race.finish.reason.timer,
      report: "/results/abc",
      labels: fr.race.finish,
    });
    expect(out).toContain(">COURSE TERMINÉE<");
    expect(out).toContain(">TEMPS ÉCOULÉ<");
    expect(out).toContain(">RAPPORT DE L&#x27;AUBE →<");
  });
});
