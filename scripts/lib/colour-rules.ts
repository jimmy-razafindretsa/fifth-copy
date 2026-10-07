/**
 * Pure colour usage rules (#15, docs/design/components.md "Colour usage rules"): `scan(files, ownership)`
 * returns one violation per offending line and rule. The CLI is scripts/check-colours.ts (check.sh step
 * `colours`); the allowlist (OWNERSHIP) lives there.
 *   raw-hex     a literal hex colour (3, 4, 6 or 8 digits): use a role from docs/design/tokens.css
 *   brand-ref   any `--brand-` reference: brand values are read only through roles
 *   ink-ground  `bg-fg`, `bg-typing-done`, `bg-room`, `bg-danger` classes, or a CSS block painting
 *               `var(--color-fg)` without the inverted label pair (`color: var(--color-bg | --color-band-fg)`)
 *   reward      gold (`--color-reward`, `*-reward` utilities) outside the places that own rewards
 *   device      phosphor and nixie (`--color-device-*`, `*-device-phosphor|nixie`) outside devices
 * Comments are stripped first (line numbers kept), so card references like `#103` never match.
 */

export type RuleId = "raw-hex" | "brand-ref" | "ink-ground" | "reward" | "device";
/** Paths (globs, `*` and `**`) where a rule does not apply: its owners or its bible-mandated exceptions. */
export type Ownership = {
  rule: Exclude<RuleId, "raw-hex" | "brand-ref">;
  paths: readonly string[];
  why: string;
};
export type SourceFile = { path: string; text: string };
export type Violation = { file: string; line: number; rule: RuleId };

/** The guard covers `src/**\/*.{ts,tsx,css}`, minus generated code and tests. */
export function isScanned(file: string): boolean {
  const p = file.split("\\").join("/");
  if (!p.startsWith("src/")) return false;
  if (p.startsWith("src/generated/")) return false;
  if (/(^|\/)(\.worktrees|node_modules)\//.test(p)) return false;
  if (/\.test\.tsx?$/.test(p)) return false;
  return /\.(ts|tsx|css)$/.test(p);
}

/**
 * Replaces comments by spaces, keeping newlines and offsets. `//` comments only outside CSS; quotes are
 * skipped so `"http://..."` stays code. JSX `{/* *\/}` is a block comment inside braces.
 */
export function stripComments(text: string, css = false): string {
  const out = text.split("");
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") j++;
        else if (text[j] === "\n" && c !== "`") break;
        j++;
      }
      i = j + 1;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (!css && c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else {
      i++;
    }
  }
  return out.join("");
}

export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const RAW_HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const BRAND = /--brand-/g;
const INK_CLASS = /(?<![\w-])bg-(?:fg|typing-done|room|danger)(?![\w-])/g;
const UTILITY =
  "(?:bg|text|border(?:-[trblxyse])?|fill|stroke|ring(?:-offset)?|outline|decoration|accent|caret|shadow|inset-shadow|from|via|to|divide|placeholder)";
const REWARD = new RegExp(`--color-reward(?![\\w-])|(?<![\\w-])${UTILITY}-reward(?![\\w-])`, "g");
const DEVICE = new RegExp(
  `--color-device-|(?<![\\w-])${UTILITY}-device-(?:phosphor|nixie)(?![\\w-])`,
  "g",
);
const INK_BG = /(?<![\w-])background(?:-color)?\s*:\s*var\(--color-fg\)\s*(?=;|$)/g;
const INVERTED = /(?<![\w-])color\s*:\s*var\(--color-(?:bg|band-fg)\)/;

function lineOf(starts: number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** One violation per (file, line, rule), sorted by file then line. */
export function scan(files: readonly SourceFile[], ownership: readonly Ownership[]): Violation[] {
  const exempt = ownership.map((o) => ({ rule: o.rule, res: o.paths.map(globToRegExp) }));
  const exempted = (rule: RuleId, file: string) =>
    exempt.some((o) => o.rule === rule && o.res.some((re) => re.test(file)));
  const out: Violation[] = [];

  for (const file of files) {
    const css = file.path.endsWith(".css");
    const code = stripComments(file.text, css);
    const starts = [0];
    for (let i = 0; i < code.length; i++) if (code[i] === "\n") starts.push(i + 1);
    const seen = new Set<string>();
    const hit = (rule: RuleId, index: number) => {
      if (exempted(rule, file.path)) return;
      const line = lineOf(starts, index);
      const key = `${line} ${rule}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ file: file.path, line, rule });
    };
    const each = (re: RegExp, rule: RuleId) => {
      for (const m of code.matchAll(re)) hit(rule, m.index);
    };

    each(RAW_HEX, "raw-hex");
    each(BRAND, "brand-ref");
    each(INK_CLASS, "ink-ground");
    each(REWARD, "reward");
    each(DEVICE, "device");
    if (css) {
      // declaration runs between braces: one block's own declarations (nested blocks are their own runs)
      for (const run of code.matchAll(/[{}]([^{}]*)/g)) {
        const body = run[1] ?? "";
        if (INVERTED.test(body)) continue;
        for (const m of body.matchAll(INK_BG)) hit("ink-ground", run.index + 1 + m.index);
      }
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
