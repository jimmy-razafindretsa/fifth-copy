import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hudLabelFixtures, SABOTAGE_CARDS } from "../view/hud-labels";
import { SabotageTray } from "./sabotage-tray";

// Contract of #560 C4 (markup; the docket look is checked in e2e/race/hud.spec.ts).
const EN = hudLabelFixtures.en.sabotageTray;
const FR = hudLabelFixtures.fr.sabotageTray;
const HINT = "ENTER TO PLAY";
const html = (el: React.ReactElement) =>
  renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
const docket = readFileSync(
  path.join(process.cwd(), "src/features/race/components/hud-docket.module.css"),
  "utf8",
);

/** The `120px | 1fr` rows: label and value text. */
const rows = (markup: string) =>
  [
    ...markup.matchAll(
      /data-row="(\w+)"[^>]*>[\s\S]*?<dt[^>]*>([^<]*)<\/dt><dd[^>]*>([^<]*)<\/dd>/g,
    ),
  ].map((m) => ({ row: m[1], label: m[2], value: m[3] }));

describe("SabotageTray (#560 C4)", () => {
  it("is a 7.4 docket headed SABOTAGE TRAY / PLATEAU DE SABOTAGE", () => {
    const en = html(<SabotageTray card={null} cooldownS={0} hint={null} labels={EN} />);
    expect(en).toMatch(/^<section[^>]*aria-label="SABOTAGE TRAY"[^>]*data-sabotage-tray/);
    expect(en).toContain(">SABOTAGE TRAY<");
    const fr = html(<SabotageTray card={null} cooldownS={0} hint={null} labels={FR} />);
    expect(fr).toContain(">PLATEAU DE SABOTAGE<");
    expect(docket).toMatch(/\.docket \{[^}]*border: 2px solid var\(--color-fg\)/);
  });

  it("empty: the dashed empty slot with its title and line, no rows", () => {
    const out = html(<SabotageTray card={null} cooldownS={0} hint={HINT} labels={EN} />);
    expect(out).toContain('data-card="none"');
    expect(out).toContain("data-empty");
    expect(out).toContain(">NO CARD<");
    expect(out).toContain(EN.empty.body);
    expect(rows(out)).toEqual([]);
  });

  it("shows each of the three cards by name and effect, in English and French, with the play hint", () => {
    expect(SABOTAGE_CARDS).toEqual(["extra-paperwork", "exemption", "smoke-break"]);
    const names = { en: [] as string[], fr: [] as string[] };
    for (const card of SABOTAGE_CARDS) {
      for (const [lang, labels] of [
        ["en", EN],
        ["fr", FR],
      ] as const) {
        const out = html(<SabotageTray card={card} cooldownS={0} hint={HINT} labels={labels} />);
        expect(out).toContain(`data-card="${card}"`);
        expect(out).toContain(`>${labels.cards[card].name}<`);
        expect(out).toContain(labels.cards[card].effect);
        expect(out).not.toContain("data-empty");
        expect(rows(out)).toEqual([{ row: "play", label: labels.play, value: HINT }]);
        names[lang].push(labels.cards[card].name);
      }
    }
    expect(names.en).toEqual(["EXTRA PAPERWORK", "EXEMPTION", "SMOKE BREAK"]);
    expect(names.fr).toEqual(["PAPERASSE SUPPLÉMENTAIRE", "EXEMPTION", "PAUSE CIGARETTE"]);
  });

  it("card: null while cooling shows only the cooldown row", () => {
    const out = html(<SabotageTray card={null} cooldownS={12} hint={HINT} labels={EN} />);
    expect(out).not.toContain("data-empty");
    expect(out).not.toContain("data-slot");
    expect(rows(out)).toEqual([{ row: "cooldown", label: "COOLDOWN", value: "12 S" }]);
    expect(out).toContain("data-cooling");
    const fr = html(<SabotageTray card={null} cooldownS={3.2} hint={HINT} labels={FR} />);
    expect(rows(fr)).toEqual([{ row: "cooldown", label: "RECHARGE", value: "4 S" }]);
  });

  it("a held card while cooling shows the card and the cooldown, without the play hint", () => {
    const out = html(<SabotageTray card="exemption" cooldownS={9} hint={HINT} labels={EN} />);
    expect(out).toContain("data-slot");
    expect(rows(out)).toEqual([{ row: "cooldown", label: "COOLDOWN", value: "9 S" }]);
  });

  it("the cooldown row pulses with lkPulse; no hint row without a hint", () => {
    const out = html(<SabotageTray card={null} cooldownS={5} hint={null} labels={EN} />);
    expect(out).toMatch(/data-row="cooldown"[^>]*class="[^"]*pulse/);
    const quiet = html(<SabotageTray card="smoke-break" cooldownS={0} hint={null} labels={EN} />);
    expect(rows(quiet)).toEqual([]);
  });
});
