import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Contract of #681 C1/C3: every explicit e2e deadline scales with E2E_TIMEOUT_SCALE (#629). A literal
// `timeout: 20_000` or `test.setTimeout(60_000)` in a spec is a hard ceiling on a loaded machine, so the
// only place a bare number may sit is `e2e/timeouts.ts`; specs write `scaled(N)`, `HYDRATION_WAIT`,
// `ACTION_WAIT` or another named export of that file.
const root = process.cwd();
const e2e = path.join(root, "e2e");
const ALLOW = new Set(["e2e/timeouts.ts"]);

/** `timeout: 5_000`, `{ timeout: 5_000 }`, `test.setTimeout(60_000)`, `socket.timeout(5_000)`. */
const LITERAL_WAIT = /timeout: [0-9_]+|setTimeout\([0-9_]+\)|\.timeout\([0-9_]+\)/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return e.name.endsWith(".ts") ? [full] : [];
  });
}

/** `file:line: text` for every literal wait in `files` (paths relative to the repo root). */
function literalWaits(files: { file: string; text: string }[]): string[] {
  return files.flatMap(({ file, text }) =>
    ALLOW.has(file)
      ? []
      : text.split("\n").flatMap((line, i) =>
          LITERAL_WAIT.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [],
        ),
  );
}

describe("e2e waits go through e2e/timeouts.ts (#681)", () => {
  it("no spec under e2e/ carries a literal timeout", () => {
    const files = sources(e2e).map((full) => ({
      file: path.relative(root, full).split(path.sep).join("/"),
      text: readFileSync(full, "utf8"),
    }));
    expect(files.length).toBeGreaterThan(0);
    expect(literalWaits(files), "use scaled(N) or a named wait from e2e/timeouts.ts").toEqual([]);
  });

  it("names the file and line of an added literal wait, and allows e2e/timeouts.ts", () => {
    const spec = "e2e/x.spec.ts";
    const text = 'await page.goto("/");\nawait expect(a).toBeVisible({ timeout: 1_000 });\n';
    expect(literalWaits([{ file: spec, text }])).toEqual([
      "e2e/x.spec.ts:2: await expect(a).toBeVisible({ timeout: 1_000 });",
    ]);
    expect(literalWaits([{ file: "e2e/race/y.spec.ts", text: "test.setTimeout(60_000);" }])).toHaveLength(1);
    expect(literalWaits([{ file: "e2e/timeouts.ts", text: "timeout: 30_000" }])).toEqual([]);
    expect(literalWaits([{ file: spec, text: "{ timeout: scaled(1_000) }" }])).toEqual([]);
  });
});
