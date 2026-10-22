import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Contract of #224 C2: the machine's rows come from one seam, `machineRows({ layout, locale })`: the
// viewer's saved layout when there is one (#66 fills it), else the request's UI language (ADR 0010:
// `fr` -> CSA, `en` -> US QWERTY). The page calls it once with `layout: null`.
// The identity barrel is server-only at runtime: loading it needs the validated env and the db client,
// which these mocks stand in for (as in the identity feature's own tests).
vi.mock("@/env", () => ({ env: { NODE_ENV: "test", AUTH_SECRET: "a".repeat(32) } }));
vi.mock("@/server/db", () => ({ db: {} }));

const { machineRows } = await import("./machine-rows");
const { keyboardLayoutIds, layouts } = await import("@/features/identity");

const root = process.cwd();
const source = readFileSync(path.join(root, "src/features/race/view/machine-rows.ts"), "utf8");
const page = readFileSync(path.join(root, "src/app/race/[raceId]/page.tsx"), "utf8");

describe("machineRows (#224 C2)", () => {
  it("returns the saved layout's rows, whatever the UI language", async () => {
    for (const id of keyboardLayoutIds) {
      for (const locale of ["fr", "en"] as const) {
        expect(await machineRows({ layout: id, locale }), `${id} ${locale}`).toBe(layouts[id]);
      }
    }
  });

  it("without a saved layout: CSA for a French UI, US QWERTY for an English one", async () => {
    expect(await machineRows({ layout: null, locale: "fr" })).toBe(layouts.CSA);
    expect(await machineRows({ layout: null, locale: "en" })).toBe(layouts.US_QWERTY);
  });

  it("parses its input (a server function: the race index reaches client graphs as a reference)", async () => {
    const bad = [
      { layout: "DVORAK", locale: "fr" },
      { layout: null, locale: "de" },
      { layout: null },
      null,
    ];
    for (const input of bad) {
      await expect(machineRows(input as never), JSON.stringify(input)).rejects.toThrow();
    }
  });

  it("is a server module that reaches the layouts only through @/features/identity, on first call", () => {
    expect(source).toMatch(/^"use server";/);
    const values = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s*"([^"]+)"/gm)].map(
      (m) => m[1],
    );
    expect(values, "no static value import of the server-only identity barrel").not.toContain(
      "@/features/identity",
    );
    expect(source).toMatch(/await import\("@\/features\/identity"\)/);
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)];
    expect(exported.map((m) => m[1])).toEqual(["machineRows"]);
  });

  it("the race page calls it once with the request's UI language and no saved layout (the #66 seam)", () => {
    expect(page.match(/machineRows\(/g)).toHaveLength(1);
    expect(page).toContain("machineRows({ layout: null, locale: await getLocale() })");
    expect(page).toMatch(/import \{[^}]*\bgetLocale\b[^}]*\} from "@\/i18n"/);
    expect(page).toMatch(/\brows=\{rows\}/);
  });
});
