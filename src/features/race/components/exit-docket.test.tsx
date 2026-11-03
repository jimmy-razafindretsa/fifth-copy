import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { hudLabelFixtures } from "../view/hud-labels";
import { AsleepAtDesk } from "./asleep-at-desk";
import { ReassignedNotice } from "./reassigned-notice";

// #233 C3, C4 and C6 at unit level: the two exit dockets (bible 7.3, 7.4, 7.1). Reassigned: the ink
// REASSIGNED stamp, `WPM | 42`, `ACCURACY | 93 %`, `PLACE | LAST`, KEEP WATCHING and the ink link to the
// waiting room. Asleep at desk: the ink ASLEEP AT DESK stamp, the two stats, KEEP WATCHING and LEAVE.
// The live wiring is e2e/race/abandon.spec.ts and e2e/race/idle.spec.ts.

const noop = () => {};
const reassigned = (labels = en.race.exit) =>
  renderToStaticMarkup(
    <ReassignedNotice
      wpm={42}
      accuracy={93}
      leaveHref="/lobby/KGB-4821"
      onKeepWatching={noop}
      labels={labels}
    />,
  );
const asleep = (labels = en.race.exit) =>
  renderToStaticMarkup(
    <AsleepAtDesk
      wpm={17}
      accuracy={88}
      leaveHref="/lobby/KGB-4821"
      onKeepWatching={noop}
      labels={labels}
    />,
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, "|")
    .replaceAll("&#x27;", "'");

describe("ReassignedNotice (#233 C3)", () => {
  it("is one docket named REASSIGNED, with the ink stamp at md", () => {
    const out = reassigned();
    expect(out).toMatch(/^<section[^>]*aria-label="REASSIGNED"[^>]*data-exit="abandoned"/);
    expect(out).toMatch(/data-stamp-tone="ink"[^>]*data-stamp-size="md"/);
    expect(out).toContain(">REASSIGNED<");
  });

  it("rows WPM | 42, ACCURACY | 93 %, PLACE | LAST in order", () => {
    expect(text(reassigned())).toContain("|WPM|42|ACCURACY|93 %|PLACE|LAST|");
  });

  it("KEEP WATCHING is a button, the way back an ink link to /lobby/[code]", () => {
    const out = reassigned();
    expect(out).toMatch(/<button[^>]*>KEEP WATCHING<\/button>/);
    expect(out).toContain('<a href="/lobby/KGB-4821"');
    expect(out).toContain(">BACK TO THE WAITING ROOM →</a>");
  });

  it("reads French from the fr catalog, one language only", () => {
    const out = text(reassigned(fr.race.exit));
    expect(out).toContain("RÉAFFECTÉ");
    expect(out).toContain("|MPM|42|PRÉCISION|93 %|RANG|DERNIER|");
    expect(out).toContain("CONTINUER À REGARDER");
    expect(out).toContain("RETOUR À LA SALLE D'ATTENTE →");
    expect(out).not.toMatch(/REASSIGNED|KEEP WATCHING|ACCURACY/);
  });
});

describe("AsleepAtDesk (#233 C4)", () => {
  it("is one docket named ASLEEP AT DESK with the ink stamp, two stats, KEEP WATCHING and LEAVE", () => {
    const out = asleep();
    expect(out).toMatch(/^<section[^>]*aria-label="ASLEEP AT DESK"[^>]*data-exit="asleep"/);
    expect(out).toMatch(/data-stamp-tone="ink"/);
    expect(text(out)).toContain("|WPM|17|ACCURACY|88 %|");
    expect(out).not.toContain("PLACE");
    expect(out).toMatch(/<button[^>]*>KEEP WATCHING<\/button>/);
    expect(out).toContain(">LEAVE →</a>");
  });

  it("French: ENDORMI AU BUREAU, QUITTER", () => {
    const out = text(asleep(fr.race.exit));
    expect(out).toContain("ENDORMI AU BUREAU");
    expect(out).toContain("QUITTER →");
  });
});

describe("exit copy (#233 C6)", () => {
  it("the catalogs carry the specimen copy of hudLabelFixtures", () => {
    expect(en.race.exit).toEqual(hudLabelFixtures.en.exit);
    expect(fr.race.exit).toEqual(hudLabelFixtures.fr.exit);
  });
});
