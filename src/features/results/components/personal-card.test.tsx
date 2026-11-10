import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { REPORT_STATUSES } from "../view/dawn-report";
import type { PersonalStats } from "../view/personal";
import { personalLabels } from "../view/report-labels";
import { PersonalCard } from "./personal-card";

// Contract of #864 C2: one 7.4 docket in the personal slot, the ink tag FORM 5-R · YOUR COPY, the place
// as № n, the clean WPM as the big figure, the accuracy, the status in words when not filed; the SENT and
// RECEIVED rows with each bonus name and × n, or NONE; a suspicious result keeps its figures under the
// UNDER REVIEW row; no gold anywhere.
const EN = personalLabels(en);
const FR = personalLabels(fr);

const stats = (over: Partial<PersonalStats> = {}): PersonalStats => ({
  desk: 12,
  place: 3,
  wpm: 47.8,
  accuracy: 0.92,
  status: "FINISHED",
  suspicious: false,
  bonuses: {
    sent: [
      { kind: "extra-paperwork", count: 2 },
      { kind: "smoke-break", count: 1 },
    ],
    received: [{ kind: "exemption", count: 1 }],
  },
  ...over,
});

const render = (s: PersonalStats, labels = EN) =>
  renderToStaticMarkup(<PersonalCard stats={s} labels={labels} />);

/** The markup of the `data-row` element named `row`. */
const rowOf = (html: string, row: string) => {
  const m = html.match(new RegExp(`<div[^>]*data-row="${row}"[^>]*>(.*?)</div>`));
  if (!m) throw new Error(`no ${row} row`);
  return m[1]!;
};
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("PersonalCard (#864 C2)", () => {
  it("one docket, named by its ink tag, with the place, the big clean WPM and the accuracy", () => {
    const html = render(stats());
    expect(html.match(/data-personal/g)).toHaveLength(1);
    expect(html).toMatch(/<section[^>]*aria-labelledby="([^"]+)"/);
    const id = html.match(/aria-labelledby="([^"]+)"/)![1]!;
    expect(html).toContain(`id="${id}"`);
    expect(html).toMatch(new RegExp(`<h2[^>]*id="${id}"[^>]*>FORM 5-R · YOUR COPY</h2>`));
    expect(html).toMatch(/data-field="place"[^>]*>№ 3</);
    expect(html).toMatch(/data-field="wpm"[^>]*>48</);
    expect(html).toMatch(/data-field="accuracy"[^>]*>92\u00a0%</);
    expect(html).toContain(">WPM<");
    expect(html).toContain(">ACCURACY<");
  });

  it("no status label when filed; the status in words otherwise", () => {
    expect(render(stats())).not.toContain('data-field="status"');
    for (const status of REPORT_STATUSES.filter((s) => s !== "FINISHED")) {
      expect(render(stats({ status }))).toMatch(
        new RegExp(`data-field="status"[^>]*>${EN.status[status]}<`),
      );
    }
  });

  it("SENT and RECEIVED list each bonus by name with × n", () => {
    const html = render(stats());
    expect(text(rowOf(html, "sent"))).toBe("SENT EXTRA PAPERWORK × 2 SMOKE BREAK × 1");
    expect(text(rowOf(html, "received"))).toBe("RECEIVED EXEMPTION × 1");
    expect(rowOf(html, "sent")).toMatch(/<li[^>]*data-kind="extra-paperwork"/);
  });

  it("NONE when a side is empty", () => {
    const html = render(stats({ bonuses: { sent: [], received: [] } }));
    expect(text(rowOf(html, "sent"))).toBe("SENT NONE");
    expect(text(rowOf(html, "received"))).toBe("RECEIVED NONE");
    expect(html).not.toContain("<li");
  });

  it("a suspicious result keeps its figures under the UNDER REVIEW row", () => {
    const html = render(stats({ suspicious: true }));
    const review = html.indexOf(">UNDER REVIEW<");
    expect(review).toBeGreaterThan(-1);
    expect(html.indexOf('data-field="wpm"')).toBeGreaterThan(review);
    expect(html).toMatch(/data-field="wpm"[^>]*>48</);
    expect(render(stats())).not.toContain("UNDER REVIEW");
  });

  it("French", () => {
    const html = render(stats({ status: "LINE_CUT", bonuses: { sent: [], received: [] } }), FR);
    expect(html).toContain("FORMULAIRE 5-R · TA COPIE");
    expect(html).toContain(">MPM<");
    expect(html).toContain(">PRÉCISION<");
    expect(html).toContain(">LIGNE COUPÉE<");
    expect(text(rowOf(html, "sent"))).toBe("ENVOYÉS AUCUN");
    expect(text(rowOf(html, "received"))).toBe("REÇUS AUCUN");
    const fr2 = render(stats(), FR);
    expect(text(rowOf(fr2, "sent"))).toBe(
      "ENVOYÉS PAPERASSE SUPPLÉMENTAIRE × 2 PAUSE CIGARETTE × 1",
    );
  });

  it("no gold anywhere on the card (bible 3)", () => {
    const css = readFileSync(join(__dirname, "personal-card.module.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(css).not.toMatch(/reward|gold|medal/i);
    expect(render(stats({ suspicious: true }))).not.toMatch(/gold|reward|medal/i);
  });
});
