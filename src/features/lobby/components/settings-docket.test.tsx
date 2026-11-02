import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_RACE_SETTINGS, type RaceSettings } from "@fifth-copy/protocol";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { SETTING_ROWS, SettingsDocket, settingRows } from "./settings-docket";

// Contract of #498 C2: the read-only `FORM 5-L` docket, one bible 7.4 row per `RaceSettings` field, the
// values in words from the catalog; the accents row only in French, the backspace row only in continue
// mode; skeleton rows while the settings are unknown.
const EN = en.lobby.settings;
const FR = fr.lobby.settings;
const S = (patch: Partial<RaceSettings> = {}): RaceSettings => ({
  ...DEFAULT_RACE_SETTINGS,
  ...patch,
});

const table = (settings: RaceSettings, labels = EN) =>
  Object.fromEntries(settingRows(settings, labels).map((r) => [r.label, r.value]));

describe("SETTING_ROWS", () => {
  it("has one row per RaceSettings field, in the spec 8 order", () => {
    expect(SETTING_ROWS.map((r) => r.key).sort()).toEqual(
      Object.keys(DEFAULT_RACE_SETTINGS).sort(),
    );
    expect(SETTING_ROWS.map((r) => r.key)).toEqual([
      "language",
      "textType",
      "wordCount",
      "accentEveryWord",
      "difficulty",
      "practiceLetters",
      "includeNumbers",
      "includeSymbols",
      "includePunctuation",
      "timerS",
      "errorMode",
      "backspace",
      "bonuses",
      "bots",
      "lobbyType",
    ]);
  });
});

describe("settingRows (#498 C2)", () => {
  it("the defaults read in words, without the accents row (English race)", () => {
    expect(table(S())).toEqual({
      LANGUAGE: "ENGLISH",
      "TEXT TYPE": "REAL SENTENCES",
      WORDS: "50 WORDS",
      DIFFICULTY: "NORMAL",
      "PRACTICE LETTERS": "NONE",
      NUMBERS: "OFF",
      SYMBOLS: "OFF",
      PUNCTUATION: "ON",
      TIMER: "NO TIMER",
      "ERROR MODE": "CONTINUE",
      BACKSPACE: "ON",
      BONUSES: "ON",
      BOTS: "NONE",
      LOBBY: "PRIVATE",
    });
  });

  it("a French race shows the accents row", () => {
    expect(table(S({ language: "fr" }))).toMatchObject({ LANGUAGE: "FRENCH", ACCENTS: "OFF" });
    expect(table(S({ language: "fr", accentEveryWord: true })).ACCENTS).toBe("EVERY WORD");
  });

  it("custom difficulty spells out its recipe", () => {
    const custom = S({
      difficulty: {
        level: "custom",
        wordLength: "short",
        rareLetters: true,
        punctuationDensity: "heavy",
      },
    });
    expect(table(custom).DIFFICULTY).toBe(
      "CUSTOM · SHORT WORDS · RARE LETTERS · HEAVY PUNCTUATION",
    );
    expect(table(custom, FR)["DIFFICULTÉ"]).toBe(
      "PERSONNALISÉE · MOTS COURTS · LETTRES RARES · PONCTUATION ABONDANTE",
    );
  });

  it("block mode has no backspace row; the timer reads in minutes", () => {
    const rows = table(S({ errorMode: "block", timerS: 300 }));
    expect(rows["ERROR MODE"]).toBe("BLOCK");
    expect(rows.TIMER).toBe("5 MIN");
    expect(rows).not.toHaveProperty("BACKSPACE");
    expect(table(S({ timerS: 90 })).TIMER).toBe("1 MIN 30 S");
  });

  it("lists the bots by level, and the practice letters", () => {
    expect(table(S({ bots: [{ level: "clerk" }, { level: "major" }] })).BOTS).toBe(
      "2 BOTS · CLERK, MAJOR",
    );
    expect(table(S({ bots: [{ level: "recruit" }] })).BOTS).toBe("1 BOT · RECRUIT");
    expect(table(S({ practiceLetters: ["q", "z", "x"] }))["PRACTICE LETTERS"]).toBe("q z x");
  });

  it("reads every value in French from the French catalog", () => {
    expect(
      table(
        S({ language: "fr", bots: [{ level: "clerk" }], lobbyType: "public", timerS: 300 }),
        FR,
      ),
    ).toMatchObject({
      LANGUE: "FRANÇAIS",
      MOTS: "50 MOTS",
      "LETTRES À PRATIQUER": "AUCUNE",
      CHRONO: "5 MIN",
      "MODE D'ERREUR": "CONTINUER",
      BOTS: "1 BOT · COMMIS",
      SALLE: "PUBLIQUE",
    });
    expect(table(S(), FR).BOTS).toBe("AUCUN");
  });
});

describe("SettingsDocket view (#498 C2)", () => {
  it("header: FORM 5-L in mono plus the RACE SETTINGS tag; one dt/dd per row", () => {
    const html = renderToStaticMarkup(<SettingsDocket settings={S()} labels={EN} />);
    expect(html).toMatch(/<span class="[^"]*code[^"]*">FORM 5-L<\/span>/);
    expect(html).toMatch(/<span class="[^"]*tag[^"]*">RACE SETTINGS<\/span>/);
    expect(html.match(/<dt/g)).toHaveLength(14);
    expect(html.match(/<dd/g)).toHaveLength(14);
    expect(html).toContain('data-setting="errorMode"');
    expect(html).not.toContain('aria-busy="true"');
  });

  it("French header", () => {
    const html = renderToStaticMarkup(<SettingsDocket settings={S()} labels={FR} />);
    expect(html).toContain("RÉGLAGES DE LA COURSE");
  });

  it("skeleton rows, aria-busy, while the settings are unknown", () => {
    const html = renderToStaticMarkup(<SettingsDocket settings={null} labels={EN} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(EN.loading);
    expect(html).not.toContain("<dt");
    expect(html.match(/data-skeleton/g)).toHaveLength(14);
  });

  it("controls: a key's control replaces its value (the #110 seam), the label stays", () => {
    const html = renderToStaticMarkup(
      <SettingsDocket
        settings={S()}
        labels={EN}
        controls={{ errorMode: <select aria-label="Error mode" /> }}
      />,
    );
    expect(html).toContain('<select aria-label="Error mode"></select>');
    expect(html).toContain(">ERROR MODE</dt>");
    expect(html).not.toContain(">CONTINUE</dd>");
    expect(html.match(/<dt/g)).toHaveLength(14);
  });
});
