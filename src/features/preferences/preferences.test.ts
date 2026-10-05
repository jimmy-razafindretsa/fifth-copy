import { describe, expect, it } from "vitest";
import { localeSchema, themeSchema } from "./schema";
import { isTheme } from "./theme";

// The server actions parse their input with these schemas: anything else throws before a cookie is set.
describe("preference schemas", () => {
  it("accepts only supported locales and themes", () => {
    expect(localeSchema.parse("fr")).toBe("fr");
    expect(() => localeSchema.parse("de")).toThrow();
    expect(() => localeSchema.parse({ locale: "fr" })).toThrow();
    expect(themeSchema.parse("dark")).toBe("dark");
    expect(() => themeSchema.parse("night")).toThrow();
  });

  it("isTheme guards the cookie value", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("")).toBe(false);
    expect(isTheme(undefined)).toBe(false);
  });
});
