import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BOT_LEVEL_WPM, BOT_LEVELS } from "@fifth-copy/engine";
import { describe, expect, it } from "vitest";
import { rankFor } from "@/features/stats/view/rank";
import { en } from "./en";
import { fill } from "./format";
import { fr } from "./fr";
import { isLocale, localeFromAcceptLanguage } from "./locale";

/** Every leaf path of a catalog, e.g. `landing.story.p1`, `landing.ticker.0`. */
function leaves(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${prefix}.${i}`));
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("catalogs (ADR 0010)", () => {
  it("fr has exactly the keys of en, every string non-empty", () => {
    expect(leaves(fr).sort()).toEqual(leaves(en).sort());
    for (const catalog of [en, fr]) {
      for (const path of leaves(catalog)) {
        const value = path
          .split(".")
          .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], catalog);
        expect(value, path).toMatch(/\S/);
      }
    }
  });

  it("keeps the same placeholders in both languages", () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const path of leaves(en)) {
      const get = (c: unknown) =>
        path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], c) as string;
      expect(placeholders(get(fr)), path).toEqual(placeholders(get(en)));
    }
  });

  it("never mixes the two languages in the brand line (bible 2)", () => {
    expect(fr.landing.tagline).toBe(en.landing.tagline);
    expect(fr.brand.name).toBe(en.brand.name);
  });
});

describe("fill", () => {
  it("replaces known placeholders and leaves unknown ones", () => {
    expect(fill(en.landing.feed.room, { n: 457, time: "00:12:03" })).toBe("ROOM 457 · 00:12:03");
    expect(fill("{a} {b}", { a: 1 })).toBe("1 {b}");
  });
});

describe("podium frame titles (#714 C1, bible 14.4 Plinth clerk)", () => {
  const words = {
    en: {
      clerk: /\bclerk\b/i,
      medal: { gold: /gold medal/i, silver: /silver medal/i, bronze: /bronze medal/i },
    },
    fr: {
      clerk: /\bcommis\b/i,
      medal: {
        gold: /médaille d'or/i,
        silver: /médaille d'argent/i,
        bronze: /médaille de bronze/i,
      },
    },
  } as const;
  for (const [locale, catalog] of [
    ["en", en],
    ["fr", fr],
  ] as const) {
    it(`${locale}: each title names the clerk and the medal of the place, never dragging or spinning`, () => {
      for (const variant of ["gold", "silver", "bronze"] as const) {
        const title = catalog.results.podium.medalTitle[variant];
        expect(title, variant).toMatch(words[locale].clerk);
        expect(title, variant).toMatch(words[locale].medal[variant]);
        expect(title, variant).not.toMatch(/drag|spin|glisse|tourne/i);
      }
    });
  }
});

describe("locale", () => {
  it("accepts only the supported locales", () => {
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("picks the first supported language of Accept-Language", () => {
    expect(localeFromAcceptLanguage("fr-CA,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(localeFromAcceptLanguage("de-DE,en-US;q=0.7")).toBe("en");
    expect(localeFromAcceptLanguage("de")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });
});

describe("ranks (#999 C39, #945; bible 2 canonical strings, engine thresholds)", () => {
  // bible 2's "Ranks" row, read from the bible itself so a copy can never drift from it
  const bible = readFileSync(
    fileURLToPath(new URL("../../docs/design/bible/FIFTH_COPY_DESIGN_BIBLE.md", import.meta.url)),
    "utf8",
  );
  const row = bible.split("\n").find((line) => line.startsWith("| Ranks |"));
  const [, , enCell, frCell] = (row ?? "").split("|").map((cell) => cell.trim());
  const canonical = { en: enCell?.split(" · "), fr: frCell?.split(" · ") };

  it("the bible's Ranks row lists one name per engine level", () => {
    expect(row).toBeDefined();
    expect(canonical.en).toHaveLength(BOT_LEVELS.length);
    expect(canonical.fr).toHaveLength(BOT_LEVELS.length);
  });

  for (const [locale, catalog] of [
    ["en", en],
    ["fr", fr],
  ] as const) {
    it(`${locale}: the rank names are bible 2's canonical strings, in BOT_LEVELS order`, () => {
      expect([...catalog.landing.clerk.ranks]).toEqual(canonical[locale]);
    });
  }

  it("each rank starts at the engine's own threshold (BOT_LEVEL_WPM), never a copied one", () => {
    BOT_LEVELS.forEach((level, i) => {
      const floor = i === 0 ? 0 : BOT_LEVEL_WPM[level];
      expect(rankFor(floor).rank, level).toBe(level);
      if (i > 0) expect(rankFor(floor - 0.01).rank, level).toBe(BOT_LEVELS[i - 1]);
    });
  });
});

describe("improvement callouts (#999 C40, consumed by C48)", () => {
  it("fills the card's example in both languages", () => {
    expect(fill(en.profile.callouts.faster, { key: "ç", pct: 30 })).toBe(
      "Your ç is 30% faster than last week.",
    );
    expect(fill(fr.profile.callouts.faster, { key: "ç", pct: 30 })).toBe(
      "Ton ç est 30 % plus rapide que la semaine dernière.",
    );
  });

  it("every template names the key and its percentage", () => {
    for (const catalog of [en, fr]) {
      for (const [id, template] of Object.entries(catalog.profile.callouts)) {
        if (id === "kicker" || id === "title") continue;
        expect(template, id).toContain("{key}");
        if (id !== "steady") expect(template, id).toContain("{pct}");
      }
    }
  });
});
