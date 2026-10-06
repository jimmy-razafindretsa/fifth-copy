import { describe, expect, it } from "vitest";
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
