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
    const selector = text
      .slice(i, open)
      .replace(/^[\s;]+/, "")
      .trim();
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
    if (m?.[1] && m[2]) map.set(m[1], norm(m[2]));
  }
  return map;
}

const top = blocks(css);
const theme = decls(
  top
    .filter((b) => b.selector === "@theme")
    .map((b) => b.body)
    .join(";"),
);
const root = decls(
  top
    .filter((b) => b.selector === ":root")
    .map((b) => b.body)
    .join(";"),
);
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
  if (mix?.[1] && mix[3]) return mixSrgb(mix[1], mix[3], Number(mix[2]) / 100);
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
      .split(/\n(?=## )/)[0]!
      .split("\n")
      .filter((l) => l.startsWith("- "));
    expect(items).toHaveLength(5);
    const expectItem = (re: RegExp, ratio: string) =>
      expect(
        items.some((l) => re.test(l) && l.includes(ratio)),
        `${re} ${ratio}`,
      ).toBe(true);
    expectItem(/`fg-muted`.*80%/, "7.05:1");
    expectItem(/`typing-remaining`.*`untyped`.*85%/, "5.23:1");
    expectItem(/`link`.*dark/, "9.72:1");
    expectItem(/`danger`.*dark/, "8.08:1");
    expectItem(/Danger button.*`pressed`/, "8.75:1");
  });
});

describe("C7 contrast (computed from the token values)", () => {
  const ratio = (a: string, b: string, t: ThemeName) =>
    contrastRatio(toRgb(role(a, t)), toRgb(role(b, t)));
  const pairs = (t: ThemeName): [string, string][] => [
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
      ? ([
          ["fg-muted", "surface"],
          ["fg-muted", "surface-muted"],
          ["fg-muted", "danger-surface"],
        ] satisfies [string, string][])
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

// Contract of #21: the six font roles in @theme, Tailwind's default families removed.
describe("#21 C2 font roles", () => {
  const themeBody = top
    .filter((b) => b.selector === "@theme")
    .map((b) => b.body)
    .join(";");
  const FONTS: Record<string, string> = {
    display: "var(--face-stardos), var(--font-oswald), Impact, sans-serif",
    label: "var(--font-oswald), Impact, sans-serif",
    typing: "var(--font-plex-mono), ui-monospace, monospace",
    flavour: "var(--face-special-elite), var(--font-oswald), ui-monospace, monospace",
    body: "var(--font-courier-prime), ui-monospace, monospace",
    device: "var(--font-vt323), ui-monospace, monospace",
  };

  it("resets Tailwind's default families", () => {
    expect(themeBody).toMatch(/--font-\*\s*:\s*initial\s*;/);
  });

  it("declares the six roles as the family variable plus a generic fallback (#20: Oswald covers Cyrillic)", () => {
    for (const [name, value] of Object.entries(FONTS)) {
      expect(theme.get(`--font-${name}`), name).toBe(norm(value));
    }
    const fonts = [...theme.keys()].filter((k) => k.startsWith("--font-"));
    expect(fonts.sort()).toEqual(
      Object.keys(FONTS)
        .map((n) => `--font-${n}`)
        .sort(),
    );
    expect(theme.has("--font-sans")).toBe(false);
    expect(theme.has("--font-mono")).toBe(false);
  });
});

// Contract of #20: six type-role utilities, one font-family each, documented in components.md.
describe("#20 type roles", () => {
  const utilities = top.filter((b) => b.selector.startsWith("@utility "));
  const byName = new Map(
    utilities.map((u) => [u.selector.slice("@utility ".length).trim(), u.body]),
  );
  const ROLES = [
    "type-display-*",
    "type-label",
    "type-typing",
    "type-flavour",
    "type-body",
    "type-device",
  ];
  const props = (body: string) => {
    const map = new Map<string, string>();
    for (const part of body.split(";")) {
      const m = /^\s*([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(part);
      if (m?.[1] && m[2]) map.set(m[1], norm(m[2]));
    }
    return map;
  };

  it("C1-C4 declares the six role utilities with their face, case, tracking and size", () => {
    expect([...byName.keys()].filter((k) => k.startsWith("type-")).sort()).toEqual(
      [...ROLES].sort(),
    );
    const display = props(byName.get("type-display-*") ?? "");
    expect(display.get("font-family")).toBe("var(--font-display)");
    expect(display.get("font-weight")).toBe("700");
    expect(display.get("text-transform")).toBe("uppercase");
    expect(display.get("letter-spacing")).toBe("0.06em");
    expect(display.get("font-size")).toBe("--value(--text-display-*)");
    const label = props(byName.get("type-label") ?? "");
    expect(label.get("font-family")).toBe("var(--font-label)");
    expect(label.get("font-weight")).toBe("600");
    expect(label.get("letter-spacing")).toBe("0.18em");
    expect(label.get("font-size")).toBe("0.875rem");
    const typing = props(byName.get("type-typing") ?? "");
    expect(typing.get("font-family")).toBe("var(--font-typing)");
    expect(typing.get("font-size")).toBe("clamp(1.75rem, 2.5vw, 2.25rem)");
    expect(typing.get("font-variant-ligatures")).toBe("none");
    expect(props(byName.get("type-flavour") ?? "").get("font-family")).toBe("var(--font-flavour)");
    const body = props(byName.get("type-body") ?? "");
    expect(body.get("font-family")).toBe("var(--font-body)");
    expect(body.get("line-height")).toBe("1.55");
    const device = props(byName.get("type-device") ?? "");
    expect(device.get("font-family")).toBe("var(--font-device)");
    expect(device.get("font-variant-numeric")).toBe("tabular-nums");
  });

  it("C1 scales display through --text-display-{sm,md,lg}", () => {
    expect(theme.get("--text-display-sm")).toBe("1.5rem");
    expect(theme.get("--text-display-md")).toBe("2.25rem");
    expect(theme.get("--text-display-lg")).toBe("3.5rem");
  });

  it("C6 the six utilities are the only font-family declarations in tokens.css and src/ CSS", () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped.match(/font-family\s*:/g) ?? []).toHaveLength(6);
    for (const role of ROLES) {
      expect(byName.get(role) ?? "", role).toMatch(/font-family\s*:/);
    }
    const globals = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(globals.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/font-family\s*:/);
  });

  it("C7 C12 C17 documents the roles, the Cyrillic rule and each primitive's role", () => {
    const start = docs.indexOf("## Type roles");
    expect(start).toBeGreaterThan(-1);
    const section = docs.slice(start, docs.indexOf("\n## ", start + 1));
    for (const role of [
      "type-display-sm",
      "type-label",
      "type-typing",
      "type-flavour",
      "type-body",
      "type-device",
    ]) {
      expect(section, role).toContain(role);
    }
    expect(section).toMatch(/Cyrillic/);
    const primitives = docs.slice(docs.indexOf("## Primitives"));
    expect(primitives).toMatch(/`Button`[^\n]*type-label/);
    expect(primitives).toMatch(/`Field`[^\n]*type-label/);
    expect(primitives).toMatch(/`Alert`[^\n]*type-display-sm/);
    expect(primitives).toMatch(/`EmptyState`[^\n]*type-display-sm/);
  });
});
