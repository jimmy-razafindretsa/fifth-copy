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
    // the seconds pulse; the muted label holds (a pulsing muted label would dip under 4.5:1)
    expect(out).toMatch(/data-row="cooldown"[^>]*>[\s\S]*?<dd class="[^"]*_pulse_/);
    expect(out).not.toMatch(/<dt class="[^"]*_pulse_/);
    const quiet = html(<SabotageTray card="smoke-break" cooldownS={0} hint={null} labels={EN} />);
    expect(rows(quiet)).toEqual([]);
  });
});

// Contract of #236 C3 (markup and CSS; the computed shake and the click path run in e2e/race/bonus.spec.ts).
describe("SabotageTray play and refusal (#236 C3)", () => {
  const css = readFileSync(
    path.join(process.cwd(), "src/features/race/components/sabotage-tray.module.css"),
    "utf8",
  );
  const play = () => {};

  it("the status region is always there; IMMUNE / IMMUNISÉ shows in it while refused", () => {
    const quiet = html(
      <SabotageTray card="extra-paperwork" cooldownS={0} hint={HINT} labels={EN} />,
    );
    expect(quiet).toMatch(/<div role="status" aria-atomic="true" data-refusal="true"><\/div>/);
    const en = html(
      <SabotageTray card="extra-paperwork" cooldownS={0} hint={HINT} labels={EN} refused />,
    );
    expect(en).toMatch(
      /role="status"[^>]*data-refusal="true">\s*<p data-row="refused"[^>]*>IMMUNE<\/p>/,
    );
    const fr = html(
      <SabotageTray card="extra-paperwork" cooldownS={0} hint={HINT} labels={FR} refused />,
    );
    expect(fr).toContain(">IMMUNISÉ<");
  });

  it("the IMMUNE row shakes once with lkShake (0.4s) on the urgent ground, and holds still under reduce", () => {
    expect(css).toMatch(/@keyframes lkShake \{/);
    expect(css).toMatch(/\.refused \{[^}]*animation: lkShake 0\.4s ease-in-out;/);
    expect(css).toMatch(/\.refused \{[^}]*background: var\(--color-danger-surface\)/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.refused \{\s*animation: none;/,
    );
    expect(css).toMatch(/\[data-motion="reduce"\] \.refused \{\s*animation: none;/);
    expect(css).not.toContain("!important");
  });

  it("a ready card with onPlay gets the PLAY CARD ink button; none while cooling, empty or static", () => {
    const ready = html(
      <SabotageTray card="smoke-break" cooldownS={0} hint={HINT} labels={EN} onPlay={play} />,
    );
    expect(ready).toMatch(
      /<button type="button" data-play="true"[^>]*_ink_[^>]*>PLAY CARD<\/button>/,
    );
    expect(rows(ready)).toEqual([{ row: "play", label: "PLAY", value: HINT }]);
    const fr = html(
      <SabotageTray card="smoke-break" cooldownS={0} hint={FR.hint} labels={FR} onPlay={play} />,
    );
    expect(fr).toContain(">JOUER LA CARTE<");
    expect(rows(fr)).toEqual([{ row: "play", label: "JOUER", value: "ENTRÉE POUR JOUER" }]);
    for (const el of [
      <SabotageTray
        key="c"
        card="smoke-break"
        cooldownS={4}
        hint={HINT}
        labels={EN}
        onPlay={play}
      />,
      <SabotageTray key="e" card={null} cooldownS={0} hint={HINT} labels={EN} onPlay={play} />,
      <SabotageTray key="s" card="smoke-break" cooldownS={0} hint={HINT} labels={EN} />,
    ]) {
      expect(html(el)).not.toContain("data-play");
    }
  });

  it("the copy is in both catalogs: ENTER TO PLAY / ENTRÉE POUR JOUER", () => {
    expect(EN.hint).toBe("ENTER TO PLAY");
    expect(FR.hint).toBe("ENTRÉE POUR JOUER");
    expect([EN.immune, FR.immune]).toEqual(["IMMUNE", "IMMUNISÉ"]);
  });
});
