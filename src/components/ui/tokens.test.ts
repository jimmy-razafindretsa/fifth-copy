import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, mixSrgb, parseHex, type Rgb } from "@/lib/color";

// Contract of #16: docs/design/tokens.css (palette, roles, themes) and its docs in components.md.
const css = readFileSync(path.join(process.cwd(), "docs/design/tokens.css"), "utf8");
const docs = readFileSync(path.join(process.cwd(), "docs/design/components.md"), "utf8");

type Block = { selector: string; body: string; children: Block[] };

/** Top-level rule blocks by brace matching (comments stripped); one nesting level is enough here. */
function blocks(src: string): Block[] {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Block[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const selector = text.slice(i, open).replace(/^[\s;]+/, "").trim();
    let depth = 1;
    let j = open + 1;
    while (depth > 0 && j < text.length) {
      if (text[j] === "{") depth++;
      if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    out.push({ selector, body, children: body.includes("{") ? blocks(body) : [] });
    i = j;
  }
  return out;
}

const norm = (v: string) =>
  v
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s*,\s*/g, ", ")
    .trim();

function decls(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of body.split(";")) {
    const m = /^\s*(--[\w-]+|color-scheme)\s*:\s*([\s\S]+?)\s*$/.exec(part);
    if (m) map.set(m[1], norm(m[2]));
  }
  return map;
}

const top = blocks(css);
const theme = decls(top.filter((b) => b.selector === "@theme").map((b) => b.body).join(";"));
const root = decls(top.filter((b) => b.selector === ":root").map((b) => b.body).join(";"));
const media = top.find((b) => /^@media\s*\(prefers-color-scheme:\s*dark\)$/.test(b.selector));
const mediaDark = decls(
  media?.children.find((c) => c.selector === ':root:not([data-theme="light"])')?.body ?? "",
);
const attrDark = decls(top.find((b) => b.selector === ':root[data-theme="dark"]')?.body ?? "");

const THEMES = { light: root, mediaDark, attrDark } as const;
type ThemeName = keyof typeof THEMES;

const BRAND = {
  "agit-red": "#B81D24",
  banner: "#7E1015",
  "ribbon-violet": "#3E3A78",
  "medal-gold": "#E2B23A",
  paper: "#F1E8D6",
  newsprint: "#E4D6B8",
  "tape-paper": "#E8DCC0",
  "backroom-grey": "#6F736C",
  "press-ink": "#2A2420",
  night: "#3E3934",
  "night-panel": "#4B453E",
  "night-ink": "#F4ECDC",
  "night-muted": "#CFC6B3",
  phosphor: "#5CFF8A",
  nixie: "#FF9A3C",
} as const;

/** Replaces `var(--brand-*)` by its hex and `var(--t-*)` by the theme block's value, recursively. */
function resolve(value: string, t: ThemeName): string {
  return norm(
    value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
      const v = name.startsWith("--brand-") ? root.get(name) : THEMES[t].get(name);
      if (v === undefined) throw new Error(`unresolved ${name} in ${t}`);
      return resolve(v, t);
    }),
  );
}

/** The resolved value of a `--color-<role>` utility token in a theme. */
const role = (name: string, t: ThemeName) => {
  const v = theme.get(`--color-${name}`);
  if (v === undefined) throw new Error(`missing --color-${name}`);
  return resolve(v, t);
};

/** Evaluates a resolved hex or `color-mix(in srgb, A p%, B [q%])` to sRGB channels. */
function toRgb(v: string): Rgb {
  const mix = /^color-mix\(in srgb, (#[0-9a-f]+) (\d+)%, (#[0-9a-f]+)(?: \d+%)?\)$/.exec(v);
  if (mix) return mixSrgb(mix[1], mix[3], Number(mix[2]) / 100);
  return parseHex(v);
}

const h = (v: string) => v.toLowerCase();

describe("C1 brand values", () => {
  it("declares the fifteen brand hexes on :root, outside @theme", () => {
    for (const [name, hex] of Object.entries(BRAND)) {
      expect(root.get(`--brand-${name}`), name).toBe(h(hex));
      expect(theme.has(`--brand-${name}`)).toBe(false);
      expect(theme.has(`--color-${name}`), `no bg-${name} utility`).toBe(false);
    }
    expect([...root.keys()].filter((k) => k.startsWith("--brand-"))).toHaveLength(15);
  });

  it("carries no retired night hexes", () => {
    expect(css.toLowerCase()).not.toContain("#1e1b2e");
    expect(css.toLowerCase()).not.toContain("#2b2740");
  });
});

describe("C2/C3 themes", () => {
  it("maps the light ground, panels, ink and reds", () => {
    expect(role("bg", "light")).toBe(h(BRAND.paper));
    expect(role("surface", "light")).toBe(h(BRAND.newsprint));
    expect(role("fg", "light")).toBe(h(BRAND["press-ink"]));
    expect(role("primary", "light")).toBe(h(BRAND["agit-red"]));
    expect(role("primary-hover", "light")).toBe(h(BRAND.banner));
    expect(role("primary-fg", "light")).toBe(h(BRAND.paper));
    expect(role("pressed", "light")).toBe(h(BRAND.banner));
  });

  for (const t of ["mediaDark", "attrDark"] as const) {
    it(`maps Night shift in ${t}; reds and gold never change`, () => {
      expect(THEMES[t].get("color-scheme")).toBe("dark");
      expect(role("bg", t)).toBe(h(BRAND.night));
      expect(role("surface", t)).toBe(h(BRAND["night-panel"]));
      expect(role("fg", t)).toBe(h(BRAND["night-ink"]));
      for (const r of ["primary", "primary-hover", "primary-fg", "pressed", "reward"]) {
        expect(role(r, t), r).toBe(role(r, "light"));
      }
    });
  }
});

describe("C4 new roles", () => {
  const invariant: Record<string, string> = {
    you: BRAND["agit-red"],
    "typing-next-bg": BRAND["agit-red"],
    "typing-error": BRAND["agit-red"],
    reward: BRAND["medal-gold"],
    rival: BRAND["ribbon-violet"],
    tape: BRAND["tape-paper"],
    "typing-done": BRAND["press-ink"],
    "typing-next": BRAND.paper,
    "typing-remaining": "color-mix(in srgb, #3E3A78 85%, #E8DCC0)",
    "device-phosphor": BRAND.phosphor,
    "device-nixie": BRAND.nixie,
    "device-bezel": BRAND["press-ink"],
    room: BRAND["backroom-grey"],
    pressed: BRAND.banner,
  };

  for (const t of Object.keys(THEMES) as ThemeName[]) {
    it(`resolves every role in ${t}`, () => {
      for (const [name, value] of Object.entries(invariant)) {
        expect(role(name, t), name).toBe(norm(value));
      }
      expect(role("untyped", t)).toBe(
        t === "light" ? norm("color-mix(in srgb, #3E3A78 85%, #F1E8D6)") : h(BRAND["night-muted"]),
      );
    });
  }
});

// C5: mapping (a) on the Night shift values, plus the recorded bible extensions.
const MAPPING: Record<string, { light: string; dark: string }> = {
  danger: { light: "#7E1015", dark: "#F4ECDC" },
  "danger-surface": {
    light: "color-mix(in srgb, #E4D6B8 88%, #B81D24 12%)",
    dark: "color-mix(in srgb, #4B453E 88%, #B81D24 12%)",
  },
  success: { light: "#2A2420", dark: "#F4ECDC" },
  "success-surface": { light: "#E4D6B8", dark: "#4B453E" },
  focus: { light: "#2A2420", dark: "#F4ECDC" },
  link: { light: "#B81D24", dark: "#F4ECDC" },
  "fg-muted": { light: "color-mix(in srgb, #2A2420 80%, #F1E8D6 20%)", dark: "#CFC6B3" },
  border: {
    light: "color-mix(in srgb, #2A2420 25%, transparent)",
    dark: "color-mix(in srgb, #F4ECDC 25%, transparent)",
  },
  "surface-muted": {
    light: "color-mix(in srgb, #E4D6B8 94%, #2A2420 6%)",
    dark: "color-mix(in srgb, #4B453E 94%, #F4ECDC 6%)",
  },
};

describe("C5 mapping (a)", () => {
  for (const t of Object.keys(THEMES) as ThemeName[]) {
    it(`declares the nine --t-* roles in ${t}`, () => {
      for (const [name, v] of Object.entries(MAPPING)) {
        const decl = THEMES[t].get(`--t-${name}`);
        expect(decl, name).toBeDefined();
        expect(resolve(decl!, t), name).toBe(norm(t === "light" ? v.light : v.dark));
        expect(theme.get(`--color-${name}`), name).toBe(`var(--t-${name})`);
      }
    });
  }

  it("documents the nine rows in components.md, then the bible extensions", () => {
    const start = docs.indexOf("## Colour roles");
    const ext = docs.indexOf("Bible extensions", start);
    expect(start).toBeGreaterThan(-1);
    expect(ext).toBeGreaterThan(start);
    const table = docs.slice(start, ext).toLowerCase();
    for (const [name, v] of Object.entries(MAPPING)) {
      const row = table.split("\n").find((l) => l.startsWith(`| \`${name}\` |`));
      expect(row, name).toBeDefined();
      expect(norm(row!), name).toContain(norm(v.light));
      expect(norm(row!), name).toContain(norm(v.dark));
    }
    expect(table).toContain("text and border only; buttons fill with `pressed`");

    const items = docs
      .slice(ext)
      .split(/\n(?=## )/)[0]
      .split("\n")
      .filter((l) => l.startsWith("- "));
    expect(items).toHaveLength(5);
    const expectItem = (re: RegExp, ratio: string) =>
      expect(items.some((l) => re.test(l) && l.includes(ratio)), `${re} ${ratio}`).toBe(true);
    expectItem(/`fg-muted`.*80%/, "7.05:1");
    expectItem(/`typing-remaining`.*`untyped`.*85%/, "5.23:1");
    expectItem(/`link`.*dark/, "9.72:1");
    expectItem(/`danger`.*dark/, "8.08:1");
    expectItem(/Danger button.*`pressed`/, "8.75:1");
  });
});

describe("C7 contrast (computed from the token values)", () => {
  const ratio = (a: string, b: string, t: ThemeName) => contrastRatio(toRgb(role(a, t)), toRgb(role(b, t)));
  const pairs = (t: ThemeName) => [
    ["fg", "bg"],
    ["fg-muted", "bg"],
    ["primary-fg", "primary"],
    ["primary-fg", "pressed"],
    ["link", "bg"],
    ["untyped", "bg"],
    ["typing-done", "tape"],
    ["typing-remaining", "tape"],
    ["typing-error", "tape"],
    ["typing-next", "typing-next-bg"],
    ...(t === "light"
      ? [
          ["fg-muted", "surface"],
          ["fg-muted", "surface-muted"],
          ["fg-muted", "danger-surface"],
        ]
      : []),
  ];

  for (const t of Object.keys(THEMES) as ThemeName[]) {
    it(`reaches 4.5:1 in ${t}`, () => {
      for (const [a, b] of pairs(t)) {
        expect(ratio(a, b, t), `${a}/${b}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
