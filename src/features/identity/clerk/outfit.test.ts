import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import {
  OUTFIT_CATALOGUE,
  OUTFIT_CATEGORIES,
  outfitForDesk,
  parseOutfit,
  type Outfit,
} from "./outfit";

const REFERENCE = path.join(process.cwd(), "docs/design/bible/Fifth Copy Your Clerk.html");

/** `CATS` ids per category and `HAIRCOL`, read from the reference page's source (no evaluation). */
function referenceCatalogue() {
  const html = fs.readFileSync(REFERENCE, "utf8");
  const cats = /const CATS = \{([\s\S]*?)\n\};/.exec(html)?.[1];
  const hairCol = /const HAIRCOL = \[([^\]]*)\];/.exec(html)?.[1];
  if (!cats || !hairCol) throw new Error("CATS or HAIRCOL not found in the reference page");
  const out: Record<string, string[]> = {};
  for (const line of cats.split("\n")) {
    const m = /^\s*(\w+):\s*\{.*opts:\s*\[(.*)\]\s*\},?\s*$/.exec(line);
    if (!m) continue;
    out[m[1]!] = [...m[2]!.matchAll(/\[\s*'([^']+)'/g)].map((x) => x[1]!);
  }
  out.hairCol = [...hairCol.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
  return out;
}

const VALID: Outfit = {
  hair: "quiff",
  glasses: "dark",
  hat: "beret",
  clothes: "jacket",
  face: "beard",
  hairCol: "#1E1A17",
};

describe("OUTFIT_CATALOGUE (C2)", () => {
  it("equals the reference page's CATS ids and HAIRCOL, in order", () => {
    const reference = referenceCatalogue();
    expect(Object.keys(reference)).toEqual([...OUTFIT_CATEGORIES, "hairCol"]);
    expect(reference).toEqual(OUTFIT_CATALOGUE);
  });

  it.each([
    ["en", en],
    ["fr", fr],
  ])("%s landing.clerk.items name exactly the catalogue's ids", (_name, messages) => {
    for (const category of OUTFIT_CATEGORIES) {
      expect(Object.keys(messages.landing.clerk.items[category])).toEqual([
        ...OUTFIT_CATALOGUE[category],
      ]);
    }
  });
});

describe("parseOutfit (C2)", () => {
  it("accepts a full outfit and drops unknown keys", () => {
    expect(parseOutfit({ ...VALID, extra: "<script>", __proto__x: 1 })).toEqual(VALID);
  });

  it.each([
    ["null", null],
    ["a string", "side"],
    ["an array", ["side"]],
    ["a missing key", { ...VALID, face: undefined }],
    ["a missing hairCol", { ...VALID, hairCol: undefined }],
    ["an unknown id", { ...VALID, hat: "crown" }],
    ["an unknown colour", { ...VALID, hairCol: "#FFFFFF" }],
    ["a non-string id", { ...VALID, hair: 1 }],
    ["an id of another category", { ...VALID, hair: "beret" }],
    ["an inherited id", { ...VALID, hair: "toString" }],
  ])("rejects %s", (_name, value) => {
    expect(parseOutfit(value)).toBeNull();
  });
});

describe("outfitForDesk (C3)", () => {
  it("pins the Full Lobby reference's randCfg for desks 1, 2 and 3", () => {
    expect(outfitForDesk(1)).toEqual({
      hair: "side",
      glasses: "monocle",
      hat: "kepka",
      clothes: "braces",
      face: "clean",
      hairCol: "#C9A465",
    });
    expect(outfitForDesk(2)).toEqual({
      hair: "side",
      glasses: "square",
      hat: "eyeshade",
      clothes: "sweater",
      face: "stache",
      hairCol: "#A4552A",
    });
    expect(outfitForDesk(3)).toEqual({
      hair: "bowl",
      glasses: "none",
      hat: "ushanka",
      clothes: "cardigan",
      face: "stache",
      hairCol: "#A4552A",
    });
  });

  it("is stable, in the catalogue and varied for desks 1-60", () => {
    const desks = Array.from({ length: 60 }, (_, i) => i + 1);
    const outfits = desks.map((d) => outfitForDesk(d));
    desks.forEach((d, i) => {
      expect(outfitForDesk(d)).toEqual(outfits[i]);
      expect(parseOutfit(outfits[i])).toEqual(outfits[i]);
    });
    expect(new Set(outfits.map((o) => JSON.stringify(o))).size).toBeGreaterThan(1);
  });
});
