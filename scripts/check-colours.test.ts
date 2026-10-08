import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OWNERSHIP } from "./check-colours";
import { isScanned, scan, stripComments, type SourceFile } from "./lib/colour-rules";

// Contract of #15 C2-C5: the colour usage guard (docs/design/components.md "Colour usage rules").
const run = (files: SourceFile[]) =>
  scan(files, OWNERSHIP).map((v) => `${v.file}:${v.line} ${v.rule}`);
const one = (file: string, text: string) => run([{ path: file, text }]);

const HASH = "#"; // built at run time so this test file stays free of literal hexes too
const hex = (digits: string) => HASH + digits;

describe("C2 raw hex and --brand- references", () => {
  it("flags 3, 4, 6 and 8 digit hexes in ts, tsx and css", () => {
    expect(one("src/a.ts", `const a = "${hex("fff")}";`)).toEqual(["src/a.ts:1 raw-hex"]);
    expect(one("src/a.tsx", `\n<p style={{ color: "${hex("ffff")}" }} />`)).toEqual([
      "src/a.tsx:2 raw-hex",
    ]);
    expect(one("src/a.module.css", `.a {\n  color: ${hex("B81D24")};\n}`)).toEqual([
      "src/a.module.css:2 raw-hex",
    ]);
    expect(one("src/a.css", `.a { color: ${hex("B81D24cc")}; }`)).toEqual(["src/a.css:1 raw-hex"]);
  });

  it("ignores other lengths, non-hex words, html entities and %23-encoded data URIs", () => {
    expect(one("src/a.ts", `const a = "${hex("12345")}";`)).toEqual([]);
    expect(one("src/a.ts", `const a = "${hex("main")}";`)).toEqual([]);
    expect(one("src/a.tsx", `<p>&${hex("8592")};</p>`)).toEqual([]);
    expect(one("src/a.css", `.a { cursor: url("data:image/svg+xml,fill='%23B81D24'"); }`)).toEqual(
      [],
    );
  });

  it("strips //, /* */ and JSX {/* */} comments first, keeping line numbers", () => {
    const text = [
      `// card ${hex("103")} and ${hex("fff")}`,
      `/* ${hex("B81D24")}`,
      `   --brand-paper */`,
      `<div>{/* ${hex("abc")} */}</div>`,
      `const ok = "http://example.test/${hex("main")}";`,
      `const bad = "${hex("abc")}";`,
    ].join("\n");
    expect(one("src/a.tsx", text)).toEqual(["src/a.tsx:6 raw-hex"]);
    expect(stripComments(text).split("\n")).toHaveLength(6);
  });

  it("keeps comment markers inside strings as code", () => {
    expect(one("src/a.ts", `const u = "http://x"; const c = "${hex("abc")}";`)).toEqual([
      "src/a.ts:1 raw-hex",
    ]);
  });

  it("flags --brand- outside comments", () => {
    expect(one("src/a.module.css", `.a {\n  color: var(--brand-paper);\n}`)).toEqual([
      "src/a.module.css:2 brand-ref",
    ]);
    expect(one("src/a.ts", `/* --brand-paper */ const a = 1;`)).toEqual([]);
  });

  it("applies the hex and brand rules to the design page too", () => {
    expect(one("src/app/design/page.tsx", `const c = "${hex("abc")}";`)).toEqual([
      "src/app/design/page.tsx:1 raw-hex",
    ]);
  });

  it("scans src/**/*.{ts,tsx,css} except generated code and tests", () => {
    expect(isScanned("src/a.ts")).toBe(true);
    expect(isScanned("src/x/b.tsx")).toBe(true);
    expect(isScanned("src/x/b.module.css")).toBe(true);
    expect(isScanned("src/generated/prisma/client.ts")).toBe(false);
    expect(isScanned("src/x/b.test.ts")).toBe(false);
    expect(isScanned("src/x/b.test.tsx")).toBe(false);
    expect(isScanned("src/x/b.md")).toBe(false);
    expect(isScanned("scripts/a.ts")).toBe(false);
    expect(isScanned(".worktrees/15/src/a.ts")).toBe(false);
  });
});

describe("C3 ink grounds", () => {
  it("flags the exact bg-fg, bg-typing-done, bg-room and bg-danger classes", () => {
    for (const cls of ["bg-fg", "bg-typing-done", "bg-room", "bg-danger", "hover:bg-fg"]) {
      expect(one("src/features/x/a.tsx", `<p className="p-2 ${cls}" />`), cls).toEqual([
        "src/features/x/a.tsx:1 ink-ground",
      ]);
    }
  });

  it("allows neighbouring roles such as bg-danger-surface and bg-fg-muted", () => {
    expect(one("src/features/x/a.tsx", `<p className="bg-danger-surface bg-fg-muted" />`)).toEqual(
      [],
    );
  });

  it("allows the design inventory page to show every role as a swatch", () => {
    expect(one("src/app/design/page.tsx", `const c = ["typing-done", "bg-typing-done"];`)).toEqual(
      [],
    );
  });

  it("flags an ink background without the inverted label pair in the same block", () => {
    const css = [".panel {", "  padding: 4px;", "  background: var(--color-fg);", "}"].join("\n");
    expect(one("src/features/x/a.module.css", css)).toEqual([
      "src/features/x/a.module.css:3 ink-ground",
    ]);
    expect(one("src/features/x/a.module.css", ".p { background-color: var(--color-fg); }")).toEqual(
      ["src/features/x/a.module.css:1 ink-ground"],
    );
  });

  it("allows the inverted pair (paper text or band text on ink)", () => {
    for (const fg of ["--color-bg", "--color-band-fg"]) {
      const css = `.tag[aria-pressed="true"] {\n  background: var(--color-fg);\n  color: var(${fg});\n}`;
      expect(one("src/features/x/a.module.css", css), fg).toEqual([]);
    }
  });

  it("checks each block on its own", () => {
    const css = ".a {\n  color: var(--color-bg);\n}\n.b {\n  background: var(--color-fg);\n}";
    expect(one("src/features/x/a.module.css", css)).toEqual([
      "src/features/x/a.module.css:5 ink-ground",
    ]);
  });

  it("exempts the seeded OWNERSHIP paths (grid gaps, ink stars)", () => {
    const css = ".cards {\n  gap: 2px;\n  background: var(--color-fg);\n}";
    expect(one("src/features/landing/components/sections.module.css", css)).toEqual([]);
    expect(one("src/components/ui/star.module.css", css)).toEqual([]);
  });
});

describe("C4 reward and device ownership", () => {
  it("allows reward only in its owners", () => {
    for (const p of [
      "src/features/results/components/a.tsx",
      "src/features/stats/a.tsx",
      "src/components/ui/a.tsx",
      "src/app/design/page.tsx",
      "src/features/landing/components/footer.module.css",
      "src/features/preferences/components/toggles.module.css",
    ]) {
      expect(
        one(p, `.a { color: var(--color-reward); } /* x */ const c = "text-reward";`),
        p,
      ).toEqual([]);
    }
    expect(one("src/features/lobby/a.tsx", `<p className="text-reward" />`)).toEqual([
      "src/features/lobby/a.tsx:1 reward",
    ]);
    expect(
      one("src/features/lobby/a.module.css", `.a {\n  border-color: var(--color-reward);\n}`),
    ).toEqual(["src/features/lobby/a.module.css:2 reward"]);
  });

  it("allows device colours only in device components, the race and the design page", () => {
    for (const p of [
      "src/components/ui/device-nixie.tsx",
      "src/features/race/a.tsx",
      "src/app/design/page.tsx",
    ]) {
      expect(one(p, `<p className="text-device-phosphor bg-device-nixie" />`), p).toEqual([]);
    }
    expect(one("src/features/lobby/a.tsx", `<p className="text-device-nixie" />`)).toEqual([
      "src/features/lobby/a.tsx:1 device",
    ]);
    expect(one("src/components/ui/card.tsx", `<p className="text-device-phosphor" />`)).toEqual([
      "src/components/ui/card.tsx:1 device",
    ]);
    expect(
      one("src/features/stats/a.module.css", `.a { color: var(--color-device-bezel); }`),
    ).toEqual(["src/features/stats/a.module.css:1 device"]);
  });

  it("keeps the lobby stamp CTA on the band role, outside the device allowlist (#595)", () => {
    const lobby = "src/features/lobby/components/lobby-entry.module.css";
    const device = OWNERSHIP.find((o) => o.rule === "device");
    expect(device?.paths).not.toContain(lobby);
    expect(one(lobby, `.a { border-color: var(--color-device-bezel); }`)).toEqual([
      `${lobby}:1 device`,
    ]);
    const css = fs.readFileSync(path.join(__dirname, "..", lobby), "utf8");
    expect(css).not.toContain("--color-device-");
  });

  it("keeps every allowlist in the one exported OWNERSHIP array, each entry with a reason", () => {
    expect(new Set(OWNERSHIP.map((o) => o.rule))).toEqual(
      new Set(["ink-ground", "reward", "device"]),
    );
    for (const o of OWNERSHIP) {
      expect(o.paths.length, o.rule).toBeGreaterThan(0);
      expect(o.why.length, o.rule).toBeGreaterThan(10);
    }
  });
});

describe("C2-C5 CLI", () => {
  const cli = path.join(__dirname, "check-colours.ts");
  const tsx = path.join(__dirname, "..", "node_modules", ".bin", "tsx");

  function tree(files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "colours-"));
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    return root;
  }
  function exec(root: string): { code: number; out: string } {
    try {
      const out = execFileSync(tsx, [cli, "--root", root], { encoding: "utf8", stdio: "pipe" });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      return { code: err.status, out: err.stdout + err.stderr };
    }
  }

  it("exits 1 and prints file:line rule for each violation", () => {
    const root = tree({
      "src/features/x/a.module.css": `.a {\n  background: var(--color-fg);\n  color: ${hex("abc")};\n}`,
      "src/app/design/page.tsx": `const c = "bg-typing-done";`,
      "src/x.test.ts": `const c = "${hex("abc")}";`,
      "src/generated/a.ts": `const c = "${hex("abc")}";`,
    });
    const { code, out } = exec(root);
    expect(code).toBe(1);
    expect(out).toContain("src/features/x/a.module.css:2 ink-ground");
    expect(out).toContain("src/features/x/a.module.css:3 raw-hex");
    expect(out).toContain("colours: 2 files, 2 violations");
  }, 30_000);

  it("exits 0 with a one-line summary on a clean tree", () => {
    const root = tree({
      "src/features/x/a.module.css": `.a {\n  background: var(--color-fg);\n  color: var(--color-bg);\n}`,
    });
    const { code, out } = exec(root);
    expect(code).toBe(0);
    expect(out.trim()).toBe("colours: 1 files, 0 violations");
  }, 30_000);
});
