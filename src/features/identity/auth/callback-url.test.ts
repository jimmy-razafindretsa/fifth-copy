import { describe, expect, it } from "vitest";
import { DEFAULT_CALLBACK, safeCallbackUrl } from "./callback-url";

// #36 C5: only a same-origin path survives; everything else lands on `/`.
describe("safeCallbackUrl", () => {
  it.each(["/", "/settings", "/lobby/KGB-4821", "/results/abc?view=me#rank", "/a/b%2F%2Fc"])(
    "keeps the same-origin path %s",
    (path) => expect(safeCallbackUrl(path)).toBe(path),
  );

  it.each([
    null,
    undefined,
    "",
    "settings",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example/",
    "javascript:alert(1)",
    "/\t/evil.example",
    "/\n/evil.example",
    " /settings",
    "/settings evil",
    `/${"a".repeat(600)}`,
  ])("refuses %j", (raw) => expect(safeCallbackUrl(raw)).toBe(DEFAULT_CALLBACK));
});
