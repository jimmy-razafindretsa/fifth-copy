import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import type { CharCount, KeyFile } from "../view/key-file";
import { keyFileFixtures } from "../view/key-file-fixtures";
import { keyboardMapOf } from "../view/keyboard-map";
import { profileFixtures } from "../view/profile-fixtures";
import { KeyboardMapSection, type KeyboardMapLayout, keyName } from "./keyboard-map";
import { type ProfileKeyboard, ProfileScreen, profileLabels } from "./profile-screen";

// #324 C3-C7 (the server half): "Carte du clavier" (bible 14.3, `Profil.dc.html` `PLAN DE LA MACHINE`).
// The layouts are identity's, read through its barrel (server-only at runtime: these mocks stand in).
vi.mock("@/env", () => ({ env: { NODE_ENV: "test", AUTH_SECRET: "a".repeat(32) } }));
vi.mock("@/server/db", () => ({ db: {} }));
const { keyboardLayoutIds, layouts, numberRows } = await import("@/features/identity");

const css = readFileSync(
  path.join(process.cwd(), "src/features/stats/components/keyboard-map.module.css"),
  "utf8",
);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const NBSP = "\u00a0";

const KEYBOARD: ProfileKeyboard = {
  initial: "CSA",
  layouts: keyboardLayoutIds.map((id) => ({
    id,
    keys: { number: numberRows[id], letters: layouts[id] },
  })),
};

/** e the most struck key (147 strokes of 1 000 on CSA, 3 errors), s with a 12 % error rate. */
const BY_CHAR: Record<string, CharCount> = {
  e: { hits: 147, errors: 3 },
  a: { hits: 76, errors: 0 },
  s: { hits: 75, errors: 9 },
  "1": { hits: 2, errors: 0 },
  ù: { hits: 700, errors: 0 },
};
// a stand-in: ù on the bottom row is the most struck key here, so e's share is under 1
const TOTAL = 147 + 76 + 75 + 2 + 700;

function layoutsFor(names: Record<string, string>, byChar = BY_CHAR): KeyboardMapLayout[] {
  return KEYBOARD.layouts.map((l) => ({
    id: l.id,
    name: names[l.id]!,
    map: keyboardMapOf(byChar, l.keys),
  }));
}

const draw = (layout: string, locale: "fr" | "en" = "fr") => {
  const t = locale === "fr" ? fr : en;
  return renderToStaticMarkup(
    <KeyboardMapSection
      layouts={layoutsFor(t.settings.layout.names)}
      initial="CSA"
      labels={t.profile.keyboardMap}
      locale={locale}
      id="file-keyboard-map"
      heading="h2"
      layout={layout}
    />,
  );
};

const keyTag = (html: string, char: string) => {
  const attr = char.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const m = html.match(
    new RegExp(
      `<(?:div|a)[^>]*data-key="${attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>(.*?)</(?:div|a)>`,
    ),
  );
  return m?.[0] ?? "";
};

describe("section head and switch (#324 C3)", () => {
  it("kicker with the layout's settings label, h2, four layouts pressed on the chosen one", () => {
    const html = draw("CSA");
    expect(html).toContain(">PLAN DE LA MACHINE · FRANÇAIS CANADIEN (CSA)</p>");
    expect(html).toMatch(/<h2 id="file-keyboard-map"[^>]*>Carte du clavier<\/h2>/);
    expect(html).toContain('role="group" aria-label="Disposition du clavier"');
    const options = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]+)</g)];
    expect(options.map((m) => m[2])).toEqual([
      "FRANÇAIS CANADIEN (CSA)",
      "FRANÇAIS (CANADA)",
      "QWERTY AMÉRICAIN",
      "AZERTY",
    ]);
    expect(options.map((m) => m[1])).toEqual(["true", "false", "false", "false"]);
    const en = draw("AZERTY", "en");
    expect(en).toContain(">MACHINE PLAN · AZERTY</p>");
    expect(en).toContain(">Keyboard map</h2>");
    expect(en).toMatch(/aria-pressed="true"[^>]*data-keyboard-option="AZERTY"/);
  });

  it("the options are at least 44px, pressed ink with paper text (the 7.1 segmented toggle)", () => {
    expect(css).toMatch(/\.option \{[^}]*min-height: 44px/);
    expect(css).toMatch(
      /\.option\[aria-pressed="true"\] \{[^}]*background: var\(--color-fg\);[^}]*color: var\(--color-bg\)/,
    );
  });
});

describe("the board (#324 C4)", () => {
  it("four rows, the pads TAB, VERR., MAJ at 1.5, 1.8 and 1.3 units of one fourteenth", () => {
    const html = draw("CSA");
    for (const row of ["number", "top", "home", "bottom"]) {
      expect(html).toContain(`data-keyboard-row="${row}"`);
    }
    const u = 100 / 14;
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pad = (width: number, label: string) =>
      new RegExp(
        `${esc(`style="width:calc(${width.toFixed(2)}% - 4px)" aria-hidden="true">`)}<span[^>]*>${esc(label)}<`,
      );
    expect(html).toMatch(pad(1.5 * u, "TAB"));
    expect(html).toMatch(pad(1.8 * u, "VERR."));
    expect(html).toMatch(pad(1.3 * u, "MAJ"));
    expect(draw("CSA", "en")).toMatch(/>CAPS<[\s\S]*>SHIFT</);
    expect(keyTag(html, "e")).toContain(`width:calc(${u.toFixed(2)}% - 4px)`);
    expect(css).toMatch(/\.space \{[^}]*margin-left: 24%;[^}]*width: 50%/);
  });

  it("each typed key: its cap, a circle of sqrt(share) x 140 %, a red core of sqrt(rate / 0.12)", () => {
    const html = draw("CSA");
    const e = keyTag(html, "e");
    expect(e).toContain(">E</span>");
    expect(e).toContain(`width:${Math.round(Math.sqrt(147 / 700) * 140)}%`);
    expect(e).toContain(`width:${Math.round(Math.sqrt(3 / 147 / 0.12) * 100)}%`);
    // s misses 12 %: the core fills its circle
    expect(keyTag(html, "s")).toMatch(/style="width:100%" data-key-core=""/);
    expect(keyTag(html, "ù")).toContain("width:140%");
  });

  it("#999 C29 a special character's key links to its guide entry; a plain key stays a picture", () => {
    const html = draw("CSA");
    for (const [char, anchor] of [
      ["ç", "c-cedilla"],
      ["é", "e-acute"],
      ["ù", "u-grave"],
    ] as const) {
      const tag = keyTag(html, char);
      expect(tag).toMatch(new RegExp(`^<a [^>]*href="/guide#${anchor}"`));
      expect(tag).toMatch(/aria-label="[^"]+ · comment la taper"/);
      expect(tag).not.toContain('role="img"');
    }
    expect(keyTag(html, "e")).toMatch(/^<div [^>]*role="img"/);
    expect(keyTag(html, "e")).not.toContain("href=");
  });

  it("an untyped key: the newsprint ground, no circle", () => {
    const k = keyTag(draw("CSA"), "k");
    expect(k).toContain('data-key-typed="false"');
    expect(k).not.toContain("data-key-circle");
    expect(css).toMatch(/\.key\.untyped \{[^}]*background: var\(--color-surface\)/);
  });
});

describe("row shares and legend (#324 C5)", () => {
  it("four 7.4 cells with the row's share, then the legend, in both languages", () => {
    const fr_ = text(draw("CSA"));
    const pct = (n: number) => `${Math.round((n / TOTAL) * 100)} %`; // text() folds the no-break space
    expect(fr_).toContain(`RANGÉE DES CHIFFRES ${pct(2)}`);
    expect(fr_).toContain(`RANGÉE DU HAUT ${pct(147)}`);
    expect(fr_).toContain(`RANGÉE DE REPOS ${pct(76 + 75)}`);
    expect(fr_).toContain(`RANGÉE DU BAS ${pct(700)}`);
    expect(fr_).toContain("taille du cercle : fréquence de frappe");
    expect(fr_).toContain("cœur rouge : part des fautes");
    const en_ = text(draw("CSA", "en"));
    for (const label of ["NUMBER ROW", "TOP ROW", "HOME ROW", "BOTTOM ROW"]) {
      expect(en_).toContain(label);
    }
    expect(en_).toContain("circle size: how often you strike it");
    expect(en_).toContain("red core: share of errors");
  });
});

describe("not colour alone, no pointer needed (#324 C6)", () => {
  it("each key named with its figures; untyped keys named so; the board one labelled group", () => {
    const html = draw("CSA");
    expect(html).toContain('role="group" aria-label="Carte du clavier, FRANÇAIS CANADIEN (CSA)"');
    const e = `E : ${((147 / TOTAL) * 100).toFixed(1).replace(".", ",")}${NBSP}% des frappes, 2,0${NBSP}% de fautes`;
    expect(html).toContain(`role="img" aria-label="${e}"`);
    expect(html).toContain('aria-label="K : jamais frappée"');
    const map = keyboardMapOf(BY_CHAR, KEYBOARD.layouts[0]!.keys);
    const eKey = map.rows[1]!.keys.find((k) => k.char === "e")!;
    expect(keyName(eKey, en.profile.keyboardMap, "en")).toBe(
      `E: ${((147 / TOTAL) * 100).toFixed(1)}${NBSP}% of strokes, 2.0${NBSP}% errors`,
    );
  });

  it("switching layout redraws from the same props: AZERTY's top row starts with A", () => {
    const first = (html: string) =>
      html.match(/data-keyboard-row="top"[\s\S]*?data-key-cap="">([^<]+)</)?.[1];
    expect(first(draw("CSA"))).toBe("Q");
    expect(first(draw("AZERTY"))).toBe("A");
    expect(draw("AZERTY")).toContain('data-keyboard-layout="AZERTY"');
  });
});

describe("ProfileScreen placement (#324 C7)", () => {
  const screen = (
    fixture: keyof typeof profileFixtures,
    keyFile?: KeyFile,
    keyboard: ProfileKeyboard | null = KEYBOARD,
  ) =>
    renderToStaticMarkup(
      <ProfileScreen
        profile={profileFixtures[fixture]}
        viewer={{ name: "DOCKET-829", isGuest: false }}
        since={null}
        stage={{ clerkSrc: null, picture: null, still: true }}
        labels={profileLabels(fr)}
        locale="fr"
        links={{ play: "/", settings: "/settings", signUp: "/sign-up" }}
        keyFile={keyFile}
        keyboard={keyboard ?? undefined}
      />,
    );

  it("after the key inventory, before the attendance register, on the initial layout", () => {
    const html = screen("two-weeks", keyFileFixtures.twoWeeks, { ...KEYBOARD, initial: "AZERTY" });
    const order = [...html.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]);
    expect(order.indexOf("keyboard-map")).toBe(order.indexOf("key-inventory") + 1);
    // the accents row (#999 C55) follows the map, then the attendance register
    expect(order.indexOf("keyboard-map")).toBe(order.indexOf("accents") - 1);
    expect(order.indexOf("accents")).toBe(order.indexOf("attendance") - 1);
    expect(html).toContain('data-keyboard-layout="AZERTY"');
    expect(html).toContain(">PLAN DE LA MACHINE · AZERTY</p>");
  });

  it("absent under 3 races, without key data or without layouts, with no placeholder", () => {
    expect(screen("one-race", keyFileFixtures.twoWeeks)).not.toContain("keyboard-map");
    expect(screen("two-weeks", keyFileFixtures.empty)).not.toContain("keyboard-map");
    expect(screen("two-weeks")).not.toContain("keyboard-map");
    expect(screen("two-weeks", keyFileFixtures.twoWeeks, null)).not.toContain("keyboard-map");
  });
});
