import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_RACE_SETTINGS, MAX_BOTS, type RaceSettings } from "@fifth-copy/protocol";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { hostForm } from "./settings-controls";
import { SETTING_ROWS, SettingsDocket, settingRows } from "./settings-docket";
import { hostRows, IDLE_FORM, type FormState } from "./settings-form";

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
      "hostWatches",
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
      HOST: "TYPES",
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
    expect(html.match(/<dt/g)).toHaveLength(15);
    expect(html.match(/<dd/g)).toHaveLength(15);
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
    expect(html.match(/data-skeleton/g)).toHaveLength(15);
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
    expect(html.match(/<dt/g)).toHaveLength(15);
  });
});

// Contract of #110 C1, C2: the host's controls in the rows (bible 7.1 segmented, 7.2 inputs, 7.4 rows).
describe("SettingsDocket host form (#110 C1)", () => {
  const PREFIX = en.landing.errors.prefix;
  const host = (
    settings: RaceSettings,
    form: FormState = IDLE_FORM,
    labels = EN,
    prefix = PREFIX,
    seated = 1,
  ) =>
    renderToStaticMarkup(
      <SettingsDocket
        settings={settings}
        labels={labels}
        {...hostForm({ settings, labels, form, revision: 0, seated, prefix })}
      />,
    );
  /** The markup of each row by its `data-setting` key. */
  const rowsOf = (html: string) =>
    Object.fromEntries(
      html
        .split('data-setting="')
        .slice(1)
        .map((chunk) => [chunk.slice(0, chunk.indexOf('"')), chunk]),
    );
  const hasControl = (row = "") => /<(button|input)[ >]/.test(row);

  it("every row the host edits has its control, BOTS and LOBBY included (#114)", () => {
    const settings = S({ bots: [{ level: "clerk" }] });
    const rows = rowsOf(host(settings));
    for (const key of hostRows(settings)) expect(hasControl(rows[key]), key).toBe(true);
  });

  it("segmented toggles named by their row label, the current value pressed", () => {
    const html = host(S());
    expect(html).toContain('id="lobby-setting-errorMode"');
    expect(html).toMatch(/role="group" aria-labelledby="lobby-setting-errorMode"/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>CONTINUE<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>BLOCK<\/button>/);
    // booleans read ON | OFF from the docket's own words
    expect(rowsOf(html).bonuses).toMatch(/aria-pressed="true"[^>]*>ON<\/button>/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>ENGLISH<\/button>/);
  });

  it("numeric inputs carry the schema bounds; NO TIMER is a pressed toggle beside the minutes", () => {
    const rows = rowsOf(host(S()));
    expect(rows.wordCount).toMatch(/<input[^>]*type="number"/);
    expect(rows.wordCount).toMatch(/min="10"[^>]*max="500"|max="500"[^>]*min="10"/);
    expect(rows.wordCount).toContain('value="50"');
    expect(rows.timerS).toMatch(/aria-pressed="true"[^>]*>NO TIMER<\/button>/);
    expect(rows.timerS).toMatch(/<input[^>]*disabled/);
    expect(rows.timerS).toContain(">MIN<");
    const timed = rowsOf(host(S({ timerS: 180 })));
    expect(timed.timerS).toMatch(/aria-pressed="false"[^>]*>NO TIMER<\/button>/);
    expect(timed.timerS).toContain('value="3"');
    expect(timed.timerS).not.toMatch(/<input[^>]*disabled/);
    expect(rowsOf(host(S({ practiceLetters: ["q", "z"] }))).practiceLetters).toMatch(
      /<input[^>]*type="text"[^>]*value="qz"|value="qz"[^>]*type="text"/,
    );
  });

  it("C3: the recipe rows only while custom, right under DIFFICULTY; no backspace row in block", () => {
    expect(host(S())).not.toContain('data-setting="difficulty.wordLength"');
    const custom = host(
      S({
        difficulty: {
          level: "custom",
          wordLength: "short",
          rareLetters: true,
          punctuationDensity: "heavy",
        },
      }),
    );
    const order = [...custom.matchAll(/data-setting="([^"]+)"/g)].map((m) => m[1]);
    const at = order.indexOf("difficulty");
    expect(order.slice(at, at + 4)).toEqual([
      "difficulty",
      "difficulty.wordLength",
      "difficulty.rareLetters",
      "difficulty.punctuationDensity",
    ]);
    expect(custom).toContain(">WORD LENGTH</dt>");
    expect(custom).toMatch(/aria-pressed="true"[^>]*>SHORT<\/button>/);
    expect(custom).toMatch(/aria-pressed="true"[^>]*>HEAVY<\/button>/);
    expect(host(S({ errorMode: "block" }))).not.toContain('data-setting="backspace"');
    expect(host(S({ language: "fr" }))).toContain('data-setting="accentEveryWord"');
  });

  it("C2: pending disables every control and marks its row busy", () => {
    const html = host(S(), { status: "pending", key: "timerS" });
    const rows = rowsOf(html);
    expect(rows.timerS).toMatch(/^timerS"[^>]*aria-busy="true"/);
    expect(rows.language).not.toMatch(/^language"[^>]*aria-busy/);
    const controls = html.match(/<(button|input)[^>]*>/g) ?? [];
    expect(controls.length).toBeGreaterThan(20);
    // aria-disabled keeps the focus where it was (the minutes under NO TIMER are disabled outright)
    for (const c of controls) expect(c).toMatch(/aria-disabled="true"|disabled=""/);
    expect(rowsOf(html).wordCount).toMatch(/<input[^>]*readOnly=""|<input[^>]*readonly=""/);
  });

  it("C2, C4: a refusal is one inline error line under the rows, never the typed text", () => {
    const html = host(S(), { status: "error", key: "wordCount", error: "words" });
    expect(html).toMatch(
      /<\/dl><div[^>]*><p id="lobby-settings-error" role="alert"[^>]*><span[^>]*>RETURNED ·<\/span> Words take a whole number from 10 to 500.<\/p>/,
    );
    expect(rowsOf(html).wordCount).toContain('aria-describedby="lobby-settings-error"');
    // only the minutes input under the pressed NO TIMER is disabled: nothing is on its way
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    const letters = host(S(), {
      status: "error",
      key: "practiceLetters",
      error: "too-many-letters",
    });
    expect(letters).toContain("Practice letters take 12 letters at most.");
    expect(host(S(), { status: "error", key: "language", error: "timeout" })).toContain(
      "The room did not answer. Try again.",
    );
  });

  it("French: labels and refusals from the French catalog", () => {
    const html = host(
      S(),
      { status: "error", key: "timerS", error: "timer" },
      FR,
      fr.landing.errors.prefix,
    );
    expect(html).toMatch(/aria-pressed="true"[^>]*>SANS CHRONO<\/button>/);
    expect(html).toContain("RETOURNÉ ·");
    expect(html).toContain("Le chrono prend un nombre entier de minutes de 1 à 10.");
  });

  it("#114 C1: no bot, no sub-row: BOTS holds ADD A BOT alone", () => {
    const rows = rowsOf(host(S()));
    expect(rows.bots).toMatch(/<button type="button"[^>]*>ADD A BOT<\/button>/);
    expect(rows.bots).not.toMatch(/aria-disabled/);
    expect(Object.keys(rows).filter((k) => k.startsWith("bots."))).toEqual([]);
  });

  it("#114 C1: one sub-row per bot: BOT n | the level segments and its WPM | REMOVE BOT n", () => {
    const html = host(S({ bots: [{ level: "clerk" }, { level: "major" }, { level: "recruit" }] }));
    const order = [...html.matchAll(/data-setting="([^"]+)"/g)].map((m) => m[1]);
    const at = order.indexOf("bots");
    expect(order.slice(at)).toEqual(["bots", "bots.1", "bots.2", "bots.3", "lobbyType"]);
    const rows = rowsOf(html);
    expect(rows["bots.2"]).toContain('<dt id="lobby-setting-bots-2"');
    expect(rows["bots.2"]).toContain(">BOT 2</dt>");
    expect(rows["bots.2"]).toMatch(/role="group" aria-labelledby="lobby-setting-bots-2"/);
    for (const level of ["RECRUIT", "CLERK", "OFFICER", "COMMISSAR", "MAJOR"])
      expect(rows["bots.2"]).toMatch(
        new RegExp(`aria-pressed="(true|false)"[^>]*>${level}</button>`),
      );
    expect(rows["bots.2"]).toMatch(/aria-pressed="true"[^>]*>MAJOR<\/button>/);
    expect(rows["bots.2"]).toContain(">90 WPM</span>");
    expect(rows["bots.1"]).toContain(">35 WPM</span>");
    expect(rows["bots.3"]).toContain(">20 WPM</span>");
    expect(rows["bots.2"]).toMatch(
      /id="lobby-setting-bots-2-remove" aria-labelledby="lobby-setting-bots-2-remove lobby-setting-bots-2"[^>]*>REMOVE<\/button>/,
    );
  });

  it("#114 C1: ADD A BOT is unavailable at MAX_BOTS bots and when the 30 desks are taken", () => {
    const capped = /<button type="button" aria-disabled="true" data-full="true"[^>]*>ADD A BOT</;
    const full = S({ bots: Array.from({ length: MAX_BOTS }, () => ({ level: "clerk" as const })) });
    expect(rowsOf(host(full, IDLE_FORM, EN, PREFIX, 30)).bots).toMatch(capped);
    expect(rowsOf(host(S({ bots: [{ level: "clerk" }] }), IDLE_FORM, EN, PREFIX, 30)).bots).toMatch(
      capped,
    );
    expect(
      rowsOf(host(S({ bots: [{ level: "clerk" }] }), IDLE_FORM, EN, PREFIX, 29)).bots,
    ).not.toMatch(/aria-disabled/);
  });

  it("#114 C1, C3: a pending bot or lobby change marks its own row busy; refusals point at it", () => {
    const settings = S({ bots: [{ level: "clerk" }, { level: "major" }] });
    expect(rowsOf(host(settings, { status: "pending", key: "bots.2" }))["bots.2"]).toMatch(
      /^bots\.2"[^>]*aria-busy="true"/,
    );
    const lobby = rowsOf(host(settings, { status: "pending", key: "lobbyType" })).lobbyType;
    expect(lobby).toMatch(/^lobbyType"[^>]*aria-busy="true"/);
    const refused = host(settings, { status: "error", key: "lobbyType", error: "not-waiting" });
    expect(rowsOf(refused).lobbyType).toContain('aria-describedby="lobby-settings-error"');
    expect(refused).toContain("RETURNED ·</span> This race has already started.");
  });

  it("#114 C3: LOBBY is a PUBLIC | PRIVATE segmented toggle, the current type pressed", () => {
    const row = rowsOf(host(S({ lobbyType: "public" }))).lobbyType;
    expect(row).toMatch(/role="group" aria-labelledby="lobby-setting-lobbyType"/);
    expect(row).toMatch(
      /aria-pressed="true"[^>]*>PUBLIC<\/button><button[^>]*aria-pressed="false"[^>]*>PRIVATE</,
    );
  });

  it("#114 French: the bot rows and the lobby toggle from the French catalog", () => {
    const html = host(S({ bots: [{ level: "officer" }] }), IDLE_FORM, FR, fr.landing.errors.prefix);
    const rows = rowsOf(html);
    expect(rows.bots).toContain(">AJOUTER UN BOT</button>");
    expect(rows["bots.1"]).toContain(">BOT 1</dt>");
    expect(rows["bots.1"]).toContain(">50 MPM</span>");
    expect(rows["bots.1"]).toContain(">RETIRER</button>");
    expect(rows["bots.1"]).toMatch(/aria-pressed="true"[^>]*>OFFICIER<\/button>/);
    expect(rows.lobbyType).toMatch(/aria-pressed="true"[^>]*>PRIVÉE<\/button>/);
  });

  it("#114 C4: the guest reads BOTS and LOBBY as words", () => {
    const rows = rowsOf(
      renderToStaticMarkup(
        <SettingsDocket
          settings={S({ bots: [{ level: "clerk" }, { level: "major" }], lobbyType: "public" })}
          labels={EN}
        />,
      ),
    );
    expect(rows.bots).toContain(">2 BOTS · CLERK, MAJOR</dd>");
    expect(rows.lobbyType).toContain(">PUBLIC</dd>");
    expect(hasControl(rows.bots)).toBe(false);
  });

  it("the guest view has no control at all", () => {
    expect(hasControl(renderToStaticMarkup(<SettingsDocket settings={S()} labels={EN} />))).toBe(
      false,
    );
  });
});
