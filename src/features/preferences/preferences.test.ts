import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeSchema, themeChoiceSchema, themeSchema } from "./schema";
import { isTheme } from "./theme";

// The server actions parse their input with these schemas: anything else throws before a cookie is set.
describe("preference schemas", () => {
  it("accepts only supported locales and themes", () => {
    expect(localeSchema.parse("fr")).toBe("fr");
    expect(() => localeSchema.parse("de")).toThrow();
    expect(() => localeSchema.parse({ locale: "fr" })).toThrow();
    expect(themeSchema.parse("dark")).toBe("dark");
    expect(() => themeSchema.parse("night")).toThrow();
    // the cookie only ever holds light or dark: `system` is an action input, not a stored value
    expect(() => themeSchema.parse("system")).toThrow();
  });

  it("#19 C3 the theme choice is light, dark or system, nothing else", () => {
    for (const v of ["light", "dark", "system"]) expect(themeChoiceSchema.parse(v)).toBe(v);
    for (const v of ["night", "", "DARK", null, undefined, 1, { theme: "dark" }]) {
      expect(() => themeChoiceSchema.parse(v), String(v)).toThrow();
    }
  });

  it("#19 C2 isTheme guards the cookie value", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    for (const v of ["", "system", "night", "Dark", undefined, null, 1]) {
      expect(isTheme(v), String(v)).toBe(false);
    }
  });
});

// Contract of #19 C3: `setTheme` validates, then writes (light, dark) or deletes (system) the cookie.
const state = vi.hoisted(() => ({
  jar: new Map<string, { value: string; options?: Record<string, unknown> }>(),
  writes: [] as string[],
  revalidated: [] as string[],
  nodeEnv: "test" as string,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = state.jar.get(name);
      return c && { name, value: c.value };
    },
    set: (name: string, value: string, options: Record<string, unknown>) => {
      state.writes.push(`set ${name}=${value}`);
      state.jar.set(name, { value, options });
    },
    delete: (name: string) => {
      state.writes.push(`delete ${name}`);
      state.jar.delete(name);
    },
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (p: string, type?: string) => state.revalidated.push(`${p} ${type ?? ""}`.trim()),
}));

vi.mock("@/env", () => ({
  env: {
    get NODE_ENV() {
      return state.nodeEnv;
    },
  },
}));

const { setTheme } = await import("./actions/set-theme");
const { getTheme } = await import("./queries/get-theme");

const form = (theme: string) => {
  const f = new FormData();
  f.set("theme", theme);
  return f;
};

describe("#19 C3 setTheme", () => {
  beforeEach(() => {
    state.jar.clear();
    state.writes = [];
    state.revalidated = [];
    state.nodeEnv = "test";
  });

  for (const theme of ["light", "dark"] as const) {
    it(`writes theme=${theme} with the preference cookie options (bare value and form data)`, async () => {
      for (const input of [theme, form(theme)]) {
        state.jar.clear();
        await setTheme(input);
        expect(state.jar.get("theme")).toEqual({
          value: theme,
          options: {
            path: "/",
            maxAge: 31_536_000,
            sameSite: "lax",
            httpOnly: true,
            secure: false,
          },
        });
        // the next render reads it back
        expect(await getTheme()).toBe(theme);
      }
      expect(state.revalidated).toEqual(["/ layout", "/ layout"]);
    });
  }

  it("marks the cookie Secure in production", async () => {
    state.nodeEnv = "production";
    await setTheme("dark");
    expect(state.jar.get("theme")?.options).toMatchObject({ secure: true, httpOnly: true });
  });

  it("deletes the cookie for system, so the OS decides again", async () => {
    await setTheme("dark");
    await setTheme(form("system"));
    expect(state.writes).toEqual(["set theme=dark", "delete theme"]);
    expect(state.jar.has("theme")).toBe(false);
    expect(await getTheme()).toBeNull();
  });

  it("throws before any cookie write on anything else", async () => {
    const bad: (FormData | string)[] = ["night", "", "DARK", form("night"), new FormData()];
    for (const input of bad) {
      await expect(setTheme(input)).rejects.toThrow();
    }
    expect(state.writes).toEqual([]);
    expect(state.revalidated).toEqual([]);
  });

  it("getTheme ignores a cookie value that is not a theme", async () => {
    state.jar.set("theme", { value: "night" });
    expect(await getTheme()).toBeNull();
    state.jar.set("theme", { value: "system" });
    expect(await getTheme()).toBeNull();
  });
});
