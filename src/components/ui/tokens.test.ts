import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  // #558: the typewriter body of bible 11.1 (desk station), the typing surface's keyboard
  "typewriter-green": "#2F3A2E",
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
  it("declares the sixteen brand hexes on :root, outside @theme", () => {
    for (const [name, hex] of Object.entries(BRAND)) {
      expect(root.get(`--brand-${name}`), name).toBe(h(hex));
      expect(theme.has(`--brand-${name}`)).toBe(false);
      expect(theme.has(`--color-${name}`), `no bg-${name} utility`).toBe(false);
    }
    expect([...root.keys()].filter((k) => k.startsWith("--brand-"))).toHaveLength(16);
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

const RIVAL_NIGHT = "color-mix(in srgb, #3E3A78 50%, #F4ECDC)";

describe("C4 new roles", () => {
  const invariant: Record<string, string> = {
    you: BRAND["agit-red"],
    "typing-next-bg": BRAND["agit-red"],
    "typing-error": BRAND["agit-red"],
    reward: BRAND["medal-gold"],
    tape: BRAND["tape-paper"],
    "typing-done": BRAND["press-ink"],
    "typing-next": BRAND.paper,
    "typing-remaining": "color-mix(in srgb, #3E3A78 85%, #E8DCC0)",
    "device-phosphor": BRAND.phosphor,
    "device-nixie": BRAND.nixie,
    "device-bezel": BRAND["press-ink"],
    room: BRAND["backroom-grey"],
    pressed: BRAND.banner,
    // #558 typing surface (bible 7.7a): objects, the same in both themes like the tape
    sheet: BRAND.paper,
    typewriter: BRAND["typewriter-green"],
    "typewriter-key": BRAND["tape-paper"],
    "typewriter-key-fg": BRAND["press-ink"],
    "typewriter-chrome": BRAND["backroom-grey"],
    "typewriter-muted": "color-mix(in srgb, #6F736C 60%, #2A2420)",
  };

  for (const t of Object.keys(THEMES) as ThemeName[]) {
    it(`resolves every role in ${t}`, () => {
      for (const [name, value] of Object.entries(invariant)) {
        expect(role(name, t), name).toBe(norm(value));
      }
      expect(role("untyped", t)).toBe(
        t === "light" ? norm("color-mix(in srgb, #3E3A78 85%, #F1E8D6)") : h(BRAND["night-muted"]),
      );
      // #19 C11: rival is themed; Night shift lightens ribbon-violet with night-ink (marks reach 3:1)
      expect(role("rival", t)).toBe(t === "light" ? h(BRAND["ribbon-violet"]) : norm(RIVAL_NIGHT));
      expect(theme.get("--color-rival")).toBe("var(--t-rival)");
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
    expect(items).toHaveLength(6);
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
    // #19 C11: the rival mark on Night shift, before (ribbon-violet) and after (50% with night-ink)
    expectItem(/`rival` dark.*50%.*night-ink/, "1.13:1");
    expectItem(/`rival` dark.*50%.*night-ink/, "3.20:1");
  });
});

// #16 C7 and #19 C9-C12: WCAG 2.1 contrast of every pair the design system promises, computed from the
// declared token values (color-mix resolved with mixSrgb) in light, media dark and attribute dark.
type Pair = { fg: string; ground: string; kind: "text" | "mark" | "ring"; darkOnly?: boolean };
const text = (fg: string, ground: string): Pair => ({ fg, ground, kind: "text" });
const PAIRS: Pair[] = [
  text("fg", "bg"),
  text("fg", "surface"),
  text("fg", "surface-muted"),
  text("fg-muted", "bg"),
  text("fg-muted", "surface"),
  text("fg-muted", "surface-muted"),
  text("fg-muted", "danger-surface"),
  text("primary-fg", "primary"),
  text("primary-fg", "primary-hover"),
  text("primary-fg", "pressed"),
  text("link", "bg"),
  text("link", "surface"),
  text("danger", "bg"),
  text("danger", "surface"),
  text("danger", "danger-surface"),
  text("success", "success-surface"),
  text("untyped", "bg"),
  text("untyped", "surface"),
  text("typing-done", "tape"),
  text("typing-remaining", "tape"),
  text("typing-next", "typing-next-bg"),
  text("typing-error", "tape"),
  // #558: the typed sheet (paper, both themes) and the typewriter keys and maker's plate (bible 7.7a)
  text("typing-done", "sheet"),
  text("typing-error", "sheet"),
  text("typing-remaining", "sheet"),
  text("typewriter-key-fg", "typewriter-key"),
  text("typewriter-muted", "typewriter-key"),
  text("typewriter-key", "typewriter"),
  text("band-fg", "band"),
  text("band-muted", "band"),
  text("reward", "band"),
  text("device-phosphor", "device-bezel"),
  text("device-nixie", "device-bezel"),
  { fg: "focus", ground: "bg", kind: "ring" },
  { fg: "focus", ground: "surface", kind: "ring" },
  { fg: "rival", ground: "bg", kind: "mark" },
  { fg: "rival", ground: "surface", kind: "mark" },
  // the toggle's gold dot lights only on the night ground (bible 14.1)
  { fg: "reward", ground: "bg", kind: "mark", darkOnly: true },
];
const ratio = (a: string, b: string, t: ThemeName) =>
  contrastRatio(toRgb(role(a, t)), toRgb(role(b, t)));
const MODES = Object.keys(THEMES) as ThemeName[];

describe("C7 contrast (computed from the token values)", () => {
  for (const t of MODES) {
    it(`#19 C9 C10 text pairs reach 4.5:1 and marks and rings 3:1 in ${t}`, () => {
      for (const p of PAIRS) {
        if (p.darkOnly && t === "light") continue;
        const min = p.kind === "text" ? 4.5 : 3;
        expect(ratio(p.fg, p.ground, t), `${p.kind} ${p.fg}/${p.ground}`).toBeGreaterThanOrEqual(
          min,
        );
      }
    });
  }

  it("#19 C9 media dark and attribute dark measure the same", () => {
    for (const p of PAIRS) {
      expect(ratio(p.fg, p.ground, "attrDark"), `${p.fg}/${p.ground}`).toBe(
        ratio(p.fg, p.ground, "mediaDark"),
      );
    }
  });

  it("#19 C10 the bible 7.7 nominal 55% violet on tape is the documented before value", () => {
    const nominal = contrastRatio(mixSrgb("#3E3A78", "#E8DCC0", 0.55), parseHex("#E8DCC0"));
    expect(nominal.toFixed(2)).toBe("2.66");
    expect(docs).toContain("55% (2.66:1 on tape)");
  });

  it("#19 C12 publishes every measured ratio in the Contrast column (light | dark)", () => {
    const tables = ["## Brand roles", "## Colour roles"].map((heading) => {
      const start = docs.indexOf(heading);
      expect(start, heading).toBeGreaterThan(-1);
      const lines = docs.slice(start).split("\n");
      const head = lines.findIndex((l) => l.startsWith("| Role |"));
      expect(lines[head], heading).toMatch(/\| Contrast \|$/);
      const rows: string[] = [];
      for (const l of lines.slice(head + 2)) {
        if (!l.startsWith("|")) break;
        rows.push(l);
      }
      return rows;
    });
    const cells = tables.flat().map((row) => {
      const parts = row.split(/(?<!\\)\|/).map((c) => c.trim());
      return { first: parts[1] ?? "", contrast: parts[parts.length - 2] ?? "" };
    });
    for (const p of PAIRS) {
      const row = cells.filter((c) => c.first.includes(`\`${p.fg}\``));
      expect(row, `one row for ${p.fg}`).toHaveLength(1);
      const light = p.darkOnly ? "n/a" : ratio(p.fg, p.ground, "light").toFixed(2);
      const dark = ratio(p.fg, p.ground, "attrDark").toFixed(2);
      const entry = `${p.kind === "text" ? "" : `${p.kind} `}\`${p.ground}\` ${light} \\| ${dark}`;
      expect(row[0]!.contrast, `${p.fg}/${p.ground}`).toContain(entry);
    }
  });
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

// Contract of #574: the web fonts are committed files loaded through next/font/local, never fetched at build.
describe("#574 committed fonts", () => {
  const root = process.cwd();
  const fontsDir = path.join(root, "public/fonts");
  const fontsTs = readFileSync(path.join(root, "src/app/fonts.ts"), "utf8");
  const GOOGLE_LOADER = ["next", "font", "google"].join("/"); // split so this file never matches the C1 grep

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return sources(full);
      return /\.(ts|tsx|js|jsx|mjs|cjs|css)$/.test(e.name) ? [full] : [];
    });
  }

  it("C1 no source under src/ imports the Google font loader", () => {
    const hits = sources(path.join(root, "src")).filter((f) =>
      readFileSync(f, "utf8").includes(GOOGLE_LOADER),
    );
    expect(hits.map((f) => path.relative(root, f))).toEqual([]);
  });

  it("C1 src/app/fonts.ts loads every face from a committed woff2 under public/fonts", () => {
    expect(fontsTs).toContain('from "next/font/local"');
    const paths = [...fontsTs.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(p, p).toMatch(/^\.\.\/\.\.\/public\/fonts\/[a-z0-9-]+\.woff2$/);
      expect(existsSync(path.join(root, "src/app", p)), p).toBe(true);
    }
    const woff2 = readdirSync(fontsDir).filter((f) => f.endsWith(".woff2"));
    expect(woff2.sort()).toEqual([...new Set(paths.map((p) => path.basename(p)))].sort());
  });

  it("C1 every family in the components.md Fonts table has a Cyrillic-aware set of files", () => {
    const woff2 = readdirSync(fontsDir).filter((f) => f.endsWith(".woff2"));
    expect(woff2.some((f) => f.startsWith("oswald-") && f.endsWith("-cyrillic.woff2"))).toBe(true);
    expect(woff2.some((f) => f.startsWith("ibm-plex-mono-") && f.endsWith("-cyrillic.woff2"))).toBe(
      true,
    );
  });

  it("C4 every family in the components.md Fonts table ships its files and its licence", () => {
    const section = docs.split("## Fonts")[1]?.split("\n## ")[0] ?? "";
    expect(section).toContain("next/font/local");
    const families = [...section.matchAll(/^\| ([A-Z][A-Za-z0-9 ]+?) \| \d/gm)].map(
      (m) => m[1] ?? "",
    );
    expect(families).toHaveLength(6);
    const files = readdirSync(fontsDir);
    for (const family of families) {
      const slug = family.toLowerCase().replace(/ /g, "-");
      expect(
        files.filter((f) => f.startsWith(`${slug}-`) && f.endsWith(".woff2")).length,
        family,
      ).toBeGreaterThan(0);
      // SIL OFL 1.1 for five families; Special Elite is Apache 2.0 (google/fonts apache/specialelite).
      const licences = files.filter((f) => f.startsWith(`${slug}-LICENSE-`));
      expect(licences, family).toHaveLength(1);
      const text = readFileSync(path.join(fontsDir, licences[0] ?? ""), "utf8");
      expect(text, family).toMatch(/SIL OPEN FONT LICENSE|Apache License/i);
    }
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

  it("#531 C1 C2 no src/ CSS sets a face itself: no font shorthand or family, no raw family variable", () => {
    const src = path.join(process.cwd(), "src");
    const files = (readdirSync(src, { recursive: true }) as string[])
      .map((f) => f.split(path.sep).join("/"))
      .filter((f) => f.endsWith(".css") && !f.startsWith("generated/"));
    expect(files.length).toBeGreaterThan(5);
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(path.join(src, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        // C1 (module CSS: font / font-family declarations), C2 (any CSS: raw next/font family vars)
        if (file.endsWith(".module.css") && /^\s*font(-family)?\s*:/.test(line)) {
          hits.push(`${file}:${i + 1} ${line.trim()}`);
        }
        if (
          /var\(--font-(stardos|oswald|plex-mono|special-elite|courier-prime|vt323)\)/.test(line)
        ) {
          hits.push(`${file}:${i + 1} ${line.trim()}`);
        }
      });
    }
    expect(hits).toEqual([]);
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

describe("#28 motion tokens", () => {
  const DURATIONS = {
    "--motion-duration-fast": "120ms",
    "--motion-duration-base": "200ms",
    "--motion-duration-slam": "350ms",
    "--motion-duration-slow": "600ms",
  } as const;
  const reduceMedia = decls(
    top
      .find((b) => /^@media\s*\(prefers-reduced-motion:\s*reduce\)$/.test(b.selector))
      ?.children.find((c) => c.selector === ":root")?.body ?? "",
  );
  const reduceAttr = decls(
    top.find((b) => b.selector === ':root[data-motion="reduce"]')?.body ?? "",
  );

  it("C1 declares the four durations and two easings on :root, outside @theme", () => {
    for (const [name, value] of Object.entries(DURATIONS)) {
      expect(root.get(name), name).toBe(value);
      expect(theme.has(name), name).toBe(false);
    }
    expect(root.get("--motion-ease-out")).toBeTruthy();
    expect(root.get("--motion-ease-slam")).toBeTruthy();
  });

  for (const [label, block] of [
    ["@media (prefers-reduced-motion: reduce)", reduceMedia],
    [':root[data-motion="reduce"]', reduceAttr],
  ] as const) {
    it(`C1 zeroes the four durations under ${label}`, () => {
      for (const name of Object.keys(DURATIONS)) {
        expect(block.get(name), name).toBe("0ms");
      }
    });
  }

  it("C1 routes Tailwind's default transition duration through the fast token", () => {
    expect(theme.get("--default-transition-duration")).toBe("var(--motion-duration-fast)");
  });

  it("C2 globals.css keeps no !important and only scroll-behavior under reduce", () => {
    const globals = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const code = globals.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain("!important");
    expect(code).not.toMatch(/animation-duration|transition-duration/);
    expect(code).toMatch(/scroll-behavior:\s*auto/);
    expect(code).toContain(':root[data-motion="reduce"]');
  });
});

// Contract of #15: printed geometry (bible 6, 7.4, 17): no radius, no blur shadows, the tape shadow stays.
describe("#15 printed geometry", () => {
  it("C14 sets every radius token to 0 but --radius-full (Spinner, dots)", () => {
    for (const name of ["--radius-sm", "--radius-md", "--radius-lg"]) {
      expect(theme.get(name), name).toBe("0");
    }
    expect(theme.get("--radius-full")).toBe("9999px");
  });

  it("C13 removes the blur shadows and keeps the tape's inner sepia (bible 3.1, 7.7)", () => {
    // names built at run time so the C13 grep over src/ stays empty
    for (const size of ["sm", "md"]) expect(theme.has(`--shadow-${size}`), size).toBe(false);
    expect(theme.get("--shadow-tape")).toBe(norm("inset 0 0 22px rgb(156 122 69 / 0.45)"));
  });
});
