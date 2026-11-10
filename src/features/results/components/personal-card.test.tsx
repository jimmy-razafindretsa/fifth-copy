import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { REPORT_STATUSES } from "../view/dawn-report";
import type { PersonalStats } from "../view/personal";
import { personalLabels } from "../view/report-labels";
import { coachingFrom, TIP_IDS, type TipInput } from "../view/tip";
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

// Contract of #867 C3: ERRORS BY KEY with up to five keys, most missed first, each the character in the
// 32px portrait-cell square with × n; a space named SPACE; NONE with no error; then the tip as one
// sentence under the ink tag ORDER OF THE DAY; the special tip links to the guide; no trace: NO TRACE ON
// FILE and the tip from the accuracy alone.
const sectionOf = (html: string, name: string) => {
  const m = html.match(new RegExp(`<div[^>]*data-section="${name}"[^>]*>(.*?)</div>`));
  if (!m) throw new Error(`no ${name} section`);
  return m[1]!;
};
const withCoaching = (input: TipInput, labels = EN, s = stats()) =>
  renderToStaticMarkup(<PersonalCard stats={s} labels={labels} coaching={coachingFrom(input)} />);
const MISSED = [
  { char: "t", count: 4 },
  { char: " ", count: 3 },
  { char: "é", count: 3 },
  { char: "a", count: 2 },
  { char: "b", count: 1 },
  { char: "c", count: 1 },
];

describe("PersonalCard errors by key and tip (#867 C3)", () => {
  it("up to five keys, most missed first, each in its square with × n; a space is SPACE", () => {
    const html = withCoaching({ accuracy: 0.9, missed: MISSED });
    const keys = sectionOf(html, "keys");
    expect(keys).toMatch(/<h3[^>]*>ERRORS BY KEY<\/h3>/);
    expect(keys.match(/<li/g)).toHaveLength(5);
    expect(text(keys)).toBe("ERRORS BY KEY t × 4 SPACE × 3 é × 3 a × 2 b × 1");
    expect(keys).toMatch(/data-key="t"[^>]*><span class="[^"]*square[^"]*" data-field="key">t</);
    expect(keys).toMatch(/data-key=" "[^>]*><span class="[^"]*named[^"]*" data-field="key">SPACE</);
    // the square is the ranking's portrait cell: 32px, 2px ink rule
    const css = readFileSync(join(__dirname, "coaching.module.css"), "utf8");
    expect(css).toMatch(/min-width: 32px;\s*height: 32px;\s*border: 2px solid var\(--color-fg\)/);
  });

  it("NONE with no error, and the clean tip", () => {
    const html = withCoaching({ accuracy: 0.97, missed: [] });
    expect(text(sectionOf(html, "keys"))).toBe("ERRORS BY KEY NONE");
    expect(html).toMatch(/data-section="tip" data-tip="clean"/);
  });

  it("the tip: one sentence under the ink tag ORDER OF THE DAY, naming the key", () => {
    const html = withCoaching({ accuracy: 0.9, missed: MISSED });
    const tip = html.slice(html.indexOf('data-section="tip"'));
    expect(tip).toMatch(/<h3[^>]*>ORDER OF THE DAY<\/h3>/);
    const sentence = tip.match(/data-field="tip"[^>]*>([^<]*)</)![1]!;
    expect(sentence).toBe(
      "The t key slipped 4 times: slow down on it next race and the rest will follow.",
    );
    expect(sentence.match(/[.!?]/g)).toHaveLength(1); // one sentence
    expect(tip).not.toContain("data-guide");
    // the keys come before the tip, both after the bonus rows
    expect(html.indexOf('data-section="bonuses"')).toBeLessThan(html.indexOf('data-section="keys"'));
    expect(html.indexOf('data-section="keys"')).toBeLessThan(html.indexOf('data-section="tip"'));
  });

  it("a space names SPACE in the tip", () => {
    const html = withCoaching({ accuracy: 0.9, missed: [{ char: " ", count: 3 }] });
    expect(html).toContain("The SPACE key slipped 3 times");
  });

  it("the special tip links to the guide", () => {
    const html = withCoaching({ accuracy: 0.9, missed: [{ char: "é", count: 5 }] });
    expect(html).toMatch(/data-tip="special"/);
    expect(html).toContain("The é key slipped 5 times: the guide shows how to type it.");
    const link = html.match(/<a [^>]*data-guide[^>]*>([^<]*)<\/a>/)!;
    expect(link[0]).toContain('href="/#how"');
    expect(link[1]).toBe("HOW TO TYPE É Ç « »");
  });

  it("no trace on file: NO TRACE ON FILE, the tip from the accuracy alone", () => {
    const low = withCoaching({ accuracy: 0.85, missed: null });
    expect(text(sectionOf(low, "keys"))).toBe("ERRORS BY KEY NO TRACE ON FILE");
    expect(low).toMatch(/data-tip="accuracy"/);
    expect(withCoaching({ accuracy: 0.95, missed: null })).toMatch(/data-tip="steady"/);
    expect(withCoaching({ accuracy: 1, missed: null })).toMatch(/data-tip="clean"/);
  });

  it("every tip has one sentence, in both languages", () => {
    for (const labels of [EN, FR]) {
      for (const id of TIP_IDS) {
        const sentence = labels.tip[id];
        expect(sentence.length).toBeGreaterThan(0);
        expect(sentence.match(/[.!?]/g), `${id}: one sentence`).toHaveLength(1);
      }
    }
  });

  it("French", () => {
    const html = withCoaching({ accuracy: 0.9, missed: [{ char: " ", count: 3 }] }, FR);
    expect(text(sectionOf(html, "keys"))).toBe("ERREURS PAR TOUCHE ESPACE × 3");
    expect(html).toContain(">ORDRE DU JOUR<");
    expect(html).toContain("La touche ESPACE t&#x27;a échappé 3 fois");
    expect(text(sectionOf(withCoaching({ accuracy: 1, missed: [] }, FR), "keys"))).toBe(
      "ERREURS PAR TOUCHE AUCUNE",
    );
    expect(text(sectionOf(withCoaching({ accuracy: 1, missed: null }, FR), "keys"))).toBe(
      "ERREURS PAR TOUCHE AUCUNE TRACE AU DOSSIER",
    );
    const special = withCoaching({ accuracy: 0.9, missed: [{ char: "«", count: 3 }] }, FR);
    expect(special).toContain(">TAPER É Ç « »<");
  });

  it("left out, the card has neither section; no gold in them (bible 3)", () => {
    expect(render(stats())).not.toContain('data-section="keys"');
    expect(render(stats())).not.toContain('data-section="tip"');
    const css = readFileSync(join(__dirname, "coaching.module.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(css).not.toMatch(/reward|gold|medal/i);
  });
});
