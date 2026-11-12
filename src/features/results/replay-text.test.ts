import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { analyseTrace, type TraceAnalysisInput } from "@fifth-copy/engine";

// Read through the feature's index (its public surface for the worker and #302), whose server
// exports reach the db client and the validated env: stub both, as the server tests do.
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("@/env", () => ({ env: { NODE_ENV: "test", AUTH_SECRET: "a".repeat(32) } }));
const { storedEffectiveText } = await import("./index");

// #623 C4: a stored result's trace is replayed on the text its desk typed, rebuilt from the stored
// base text and overlay, never on the base text alone.

// The engine's trace fixtures are data files (read, not imported: packages are consumed by name).
const human = JSON.parse(
  readFileSync(
    new URL("../../../packages/engine/src/anticheat/fixtures/human-1.json", import.meta.url),
    "utf8",
  ),
) as TraceAnalysisInput;

const codesOn = (text: string) => analyseTrace({ ...human, text }).map((f) => f.code);

describe("storedEffectiveText (#623 C4)", () => {
  // The fixture's human typed `human.text`. Stage it as an overlaid desk: the race's base text
  // carries one more word up front (removed by Exemption) and lacks the last two words (appended
  // by Extra Paperwork). Stored raw, as `Race.textContent` is: a curly apostrophe and a double space.
  const words = human.text.split(" ");
  const textContent = `l’intrus  ${words.slice(0, -2).join(" ")}`;
  const overlay = { extra: words.slice(-2), removed: [0] };

  it("rebuilds the text the desk typed: analyseTrace reproduces the trace there, not on the base", () => {
    const text = storedEffectiveText({ textContent, overlay });
    expect(text).toBe(human.text);
    expect(codesOn(text)).not.toContain("unreproducible");
    expect(codesOn(storedEffectiveText({ textContent, overlay: null }))).toContain(
      "unreproducible",
    );
  });

  it("is the normalised base text when the stored overlay is null (or an empty overlay)", () => {
    expect(storedEffectiveText({ textContent: "  Le  dossier’s ", overlay: null })).toBe(
      "Le dossier's",
    );
    expect(
      storedEffectiveText({ textContent: "le dossier", overlay: { extra: [], removed: [] } }),
    ).toBe("le dossier");
    expect(codesOn(storedEffectiveText({ textContent: human.text, overlay: null }))).not.toContain(
      "unreproducible",
    );
  });

  it.each([
    ["a string", "quota"],
    ["missing removed", { extra: ["quota"] }],
    ["a negative index", { extra: [], removed: [-1] }],
    ["a non-string word", { extra: [42], removed: [] }],
  ])(
    "throws on a stored overlay that is not one (%s), never falls back to the base",
    (_, overlay) => {
      expect(() => storedEffectiveText({ textContent: "le dossier", overlay })).toThrow();
    },
  );
});
