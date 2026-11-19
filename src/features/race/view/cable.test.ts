import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { cableHeader } from "./cable";

// #999 C40 (R26): the intercepted-cable header that frames each race text, never part of it.
describe("cableHeader", () => {
  const ids = Array.from({ length: 40 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

  it("is the same for the same race, in both languages the same template slot", () => {
    for (const id of ids) {
      expect(cableHeader(id, en.race.telex.cables)).toBe(cableHeader(id, en.race.telex.cables));
      const enIndex = en.race.telex.cables.findIndex((t) =>
        cableHeader(id, en.race.telex.cables)!.startsWith(t.split("{n}")[0]!),
      );
      expect(enIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("fills a four-digit cable number and uses every template over many races", () => {
    const seen = new Set<string>();
    for (const id of ids) {
      const header = cableHeader(id, fr.race.telex.cables)!;
      expect(header).toMatch(/№ [1-9]\d{3}\b/);
      expect(header).not.toContain("{");
      seen.add(header.replace(/\d{4}/, "#"));
    }
    expect(seen.size).toBe(fr.race.telex.cables.length);
  });

  it("every template is an intercepted cable, upper case, carrying the number", () => {
    for (const [locale, word] of [
      [en, "INTERCEPTED CABLE"],
      [fr, "CÂBLE INTERCEPTÉ"],
    ] as const) {
      expect(locale.race.telex.cables.length).toBeGreaterThanOrEqual(5);
      for (const t of locale.race.telex.cables) {
        expect(t.startsWith(`${word} · № {n}`), t).toBe(true);
        const words = t.replace("{n}", "");
        expect(words).toBe(words.toUpperCase());
      }
    }
  });

  it("no templates, no header", () => {
    expect(cableHeader(ids[0]!, [])).toBeNull();
  });
});
