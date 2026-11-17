import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import {
  emptyKeyFile,
  type KeyFile,
  type KeyFileEntry,
  KEY_GOAL_WPM,
  REFERENCE_KEYS,
} from "../view/key-file";
import { keyFileFixtures } from "../view/key-file-fixtures";
import { INVENTORY_ROWS, inventoryRows } from "../view/key-inventory";
import { profileFixtures } from "../view/profile-fixtures";
import { inventoryCells, KeyInventory } from "./key-inventory";
import { ProfileScreen, profileLabels } from "./profile-screen";

// #964 C1-C5: the key inventory ("Vitesse, frappes et fautes", bible 14.3).
const root = process.cwd();
const css = readFileSync(
  path.join(root, "src/features/stats/components/key-inventory.module.css"),
  "utf8",
);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** A key met at `averageWpm` with `hits` and `errors` (state from the goal, as `keyFileOf` sets it). */
function met(char: string, averageWpm: number, hits: number, errors: number): KeyFileEntry {
  return {
    char,
    state: averageWpm < KEY_GOAL_WPM ? "weak" : "good",
    series: [averageWpm],
    hits,
    errors,
    errorRate: hits > 0 ? errors / hits : null,
    averageWpm,
    latestWpm: averageWpm,
    bestWpm: averageWpm,
    learningRate: null,
  };
}

/**
 * The fixture: `a` at 34.9 WPM (just under the goal), `e` at 35 (on it) and most struck, `s` at 72
 * (over the scale) and most missed, `ç` at 20 with the highest error rate; every other key never met.
 */
const FIXTURE: KeyFile = (() => {
  const base = emptyKeyFile();
  const custom: Record<string, KeyFileEntry> = {
    a: met("a", 34.9, 100, 5),
    e: met("e", 35, 400, 8),
    s: met("s", 72, 200, 20),
    ç: met("ç", 20, 10, 4),
  };
  return { ...base, days: ["2026-11-01"], keys: base.keys.map((k) => custom[k.char] ?? k) };
})();

const render = (lang: "fr" | "en", keyFile = FIXTURE) =>
  renderToStaticMarkup(
    <KeyInventory
      keyFile={keyFile}
      labels={profileLabels(lang === "en" ? en : fr).keyInventory}
      locale={lang}
      id="ki"
      heading="h2"
    />,
  );

const row = (html: string, id: string) =>
  html.split(`data-inventory-row="${id}"`)[1]!.split("data-inventory-row")[0]!;
const bar = (html: string, id: string, char: string) =>
  row(html, id).match(new RegExp(`<span[^>]*data-bar="${char}"[^>]*>`))![0];

describe("KeyInventory (#964)", () => {
  it("C1 the section head in both languages", () => {
    const frHtml = render("fr");
    expect(frHtml).toContain('aria-labelledby="ki"');
    expect(text(frHtml)).toContain("INVENTAIRE DES TOUCHES");
    expect(frHtml).toMatch(/<h2 id="ki"[^>]*>Vitesse, frappes et fautes<\/h2>/);
    expect(text(frHtml)).toContain(
      "Vitesse moyenne par touche, puis combien de fois tu l'as frappée, ratée, et la proportion de ratés.",
    );
    const enHtml = render("en");
    expect(text(enHtml)).toContain("KEY INVENTORY");
    expect(enHtml).toMatch(/<h2 id="ki"[^>]*>Speed, strokes and errors<\/h2>/);
    expect(text(enHtml)).toContain(
      "Average speed per key, then how many times you struck it, missed it, and the share of misses.",
    );
  });

  it("C2 four rows of 30 bars in the key order, the reference's heights and labels", () => {
    const html = render("fr");
    const ids = [...html.matchAll(/data-inventory-row="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["speed", "strokes", "errors", "ratio"]);
    for (const id of ids) {
      const bars = [...row(html, id!).matchAll(/data-bar="([^"]+)"/g)].map((m) => m[1]);
      expect(bars).toEqual([...REFERENCE_KEYS]);
    }
    expect(row(html, "speed")).toContain("height:150px");
    for (const id of ["strokes", "errors", "ratio"]) expect(row(html, id)).toContain("height:80px");
    expect(text(html)).toMatch(/VITESSE MOY\. .*FRAPPES .*FAUTES .*RATIO FAUTES/);
    expect(text(render("en"))).toMatch(/AVG SPEED .*STROKES .*ERRORS .*ERROR RATIO/);
    // the 30 caps under the rows, upper case in the locale
    const caps = html.split("data-inventory-caps")[1]!.split("</div>")[0]!;
    expect([...caps.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1])).toEqual(
      REFERENCE_KEYS.map((k) => k.toLocaleUpperCase("fr")),
    );
  });

  it("C2 bar heights: 0 to 60 WPM with the goal at 35, the others relative to the row's largest", () => {
    const rows = inventoryRows(FIXTURE);
    const at = (id: string, char: string) =>
      rows.find((r) => r.id === id)!.bars.find((b) => b.char === char)!;
    // speed: the goal boundary, 34.9 under (weak), 35 on it (good); over 60 sits at the top
    expect(rows[0]!.goalAt).toBe(58.3);
    expect(at("speed", "a")).toEqual({ char: "a", height: 58.2, look: "weak" });
    expect(at("speed", "e")).toEqual({ char: "e", height: 58.3, look: "good" });
    expect(at("speed", "s")).toEqual({ char: "s", height: 100, look: "good" });
    expect(at("speed", "ç")).toEqual({ char: "ç", height: 33.3, look: "weak" });
    // strokes: e (400) is the tallest
    expect(at("strokes", "e").height).toBe(100);
    expect(at("strokes", "a").height).toBe(25);
    expect(at("strokes", "s").look).toBe("ink");
    // errors: s (20) is the tallest
    expect(at("errors", "s").height).toBe(100);
    expect(at("errors", "e").height).toBe(40);
    expect(at("errors", "s").look).toBe("red");
    // error ratio: ç (40 %) is the tallest
    expect(at("ratio", "ç").height).toBe(100);
    expect(at("ratio", "s").height).toBe(25);
    expect(at("ratio", "a").height).toBe(12.5);
    expect(at("ratio", "ç").look).toBe("muted");
    // a key never met has no bar in any row
    for (const r of rows) expect(r.bars.find((b) => b.char === "k")!.height).toBeNull();
    // the goal line only on the speed row
    expect(rows.map((r) => r.goalAt)).toEqual([58.3, null, null, null]);

    const html = render("fr");
    expect(bar(html, "speed", "a")).toContain("height:58.2%");
    expect(bar(html, "speed", "a")).toContain('data-bar-look="weak"');
    expect(bar(html, "speed", "e")).toContain('data-bar-look="good"');
    expect(bar(html, "speed", "k")).not.toContain("style=");
    expect(bar(html, "speed", "k")).toContain('data-bar-look="none"');
    expect(row(html, "speed")).toMatch(/data-inventory-goal=""|style="bottom:58.3%"/);
    expect(html.match(/data-inventory-goal/g)).toHaveLength(1);
  });

  it("C2 a row is data: a fifth row is one entry", () => {
    const extra = inventoryRows(FIXTURE, [
      ...INVENTORY_ROWS,
      {
        id: "strokes",
        height: 40,
        value: (k) => k.hits - k.errors,
        scale: "relative",
        look: () => "ink",
      },
    ]);
    expect(extra).toHaveLength(5);
    expect(extra[4]!.bars.find((b) => b.char === "e")!.height).toBe(100);
  });

  it("C2 an all-clean file: no division by zero, the error rows stay flat", () => {
    const clean: KeyFile = {
      ...FIXTURE,
      keys: FIXTURE.keys.map((k) => (k.state === "none" ? k : { ...k, errors: 0, errorRate: 0 })),
    };
    const rows = inventoryRows(clean);
    expect(rows[2]!.bars.find((b) => b.char === "e")!.height).toBe(0);
    expect(rows[3]!.bars.find((b) => b.char === "e")!.height).toBe(0);
  });

  it("C3 bars hidden from assistive tech; a table of 30 rows gives the figures with units", () => {
    const html = render("fr");
    expect(html).toMatch(/<div class="[^"]*chart[^"]*" aria-hidden="true">/);
    const table = html.split("<table")[1]!.split("</table>")[0]!;
    expect(table).toContain('class="sr-only"');
    expect(text(table.split("</caption>")[0]!)).toContain("Vitesse, frappes et fautes par touche");
    expect(text(table.split("<tbody>")[0]!)).toMatch(
      /Touche Vitesse moyenne Frappes Fautes Ratio de fautes/,
    );
    expect(table.match(/<th scope="row"/g)).toHaveLength(30);
    const e = text(table.split('data-key="e">')[1]!.split("</tr>")[0]!);
    expect(e).toBe("E 35,0 MPM, objectif atteint 400 8 2,0 %");
    const a = text(table.split('data-key="a">')[1]!.split("</tr>")[0]!);
    expect(a).toBe("A 34,9 MPM, sous l'objectif 100 5 5,0 %");
    expect(text(table.split('data-key="k">')[1]!.split("</tr>")[0]!)).toBe("K — 0 0 —");
    const enTable = render("en").split("<table")[1]!;
    expect(text(enTable.split('data-key="e">')[1]!.split("</tr>")[0]!)).toBe(
      "E 35.0 WPM, goal reached 400 8 2.0 %",
    );
    // thousands in the locale
    const big = inventoryCells(
      { ...FIXTURE.keys[4]!, hits: 12045 },
      profileLabels(en).keyInventory,
      "en",
    );
    expect(big.strokes).toBe("12,045");
    // the goal line carries pass or fail without colour: it sits on the speed row, with its legend
    expect(text(html.split("data-inventory-legend")[1]!)).toContain("objectif 35 MPM");
    expect(text(render("en").split("data-inventory-legend")[1]!)).toContain("35 WPM goal");
    expect(css).toMatch(/\.goal \{[^}]*border-top: 2px dashed var\(--color-link\)/);
  });

  it("C4 the scroll region is focusable and named; the chart keeps 30 bars, legible caps", () => {
    const html = render("fr");
    expect(html).toMatch(
      /role="region" aria-label="Vitesse, frappes et fautes, défilement horizontal" tabindex="0"/,
    );
    expect(render("en")).toContain('aria-label="Speed, strokes and errors, scrolls sideways"');
    expect(css).toMatch(/\.scroll \{[^}]*overflow-x: auto;/);
    expect(css).toMatch(/\.chart \{[^}]*min-width: 520px;/);
  });

  it("C5 colours through roles, no raw hex; ink bars declare paper text", () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/#[0-9a-f]{3,8}\b|--brand-|--color-reward/i);
    expect(code).toMatch(/\.good \{\s*background: var\(--color-rival\);/);
    expect(code).toMatch(/\.weak \{\s*background: var\(--color-primary\);/);
    expect(code).toMatch(/\.ink \{\s*background: var\(--color-fg\);\s*color: var\(--color-bg\);/);
    expect(code).toMatch(/\.muted \{\s*background: var\(--color-fg-muted\);/);
  });

  it("C5 fr and en have the same keys", () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === "object" && v !== null ? keys(v).map((s) => `${k}.${s}`) : [k],
      );
    expect(keys(en.profile.keyInventory).sort()).toEqual(keys(fr.profile.keyInventory).sort());
  });
});

describe("ProfileScreen placement (#964 C4)", () => {
  const screen = (fixture: keyof typeof profileFixtures, keyFile?: KeyFile) =>
    renderToStaticMarkup(
      <ProfileScreen
        profile={profileFixtures[fixture]}
        viewer={{ name: "DOCKET-829", isGuest: false }}
        since={null}
        stage={{ clerkSrc: null, picture: null, still: true }}
        labels={profileLabels(en)}
        locale="en"
        links={{ play: "/", settings: "/settings", signUp: "/sign-up" }}
        keyFile={keyFile}
      />,
    );

  it("right after the key sheet, before the attendance register", () => {
    const html = screen("two-weeks", keyFileFixtures.twoWeeks);
    const order = [...html.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]);
    expect(order.indexOf("key-inventory")).toBe(order.indexOf("key-sheet") + 1);
    expect(order.indexOf("key-inventory")).toBeLessThan(order.indexOf("attendance"));
  });

  it("absent under 3 races or without key data, with no placeholder", () => {
    expect(screen("one-race", keyFileFixtures.twoWeeks)).not.toContain("key-inventory");
    expect(screen("two-weeks", keyFileFixtures.empty)).not.toContain("key-inventory");
    expect(screen("two-weeks")).not.toContain("key-inventory");
  });
});
