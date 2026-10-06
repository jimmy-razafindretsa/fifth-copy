import type { Locator } from "@playwright/test";
import { expect, expectNoA11yViolations, stabilize, test } from "./fixtures";

/** Computed type of the first element matched by `locator` (#20 type roles). */
async function typeOf(locator: Locator) {
  return locator.first().evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      family: s.fontFamily.split(",")[0]?.trim() ?? "",
      stack: s.fontFamily,
      size: Number.parseFloat(s.fontSize),
      weight: s.fontWeight,
      transform: s.textTransform,
      spacing: s.letterSpacing === "normal" ? 0 : Number.parseFloat(s.letterSpacing),
      lineHeight: s.lineHeight,
      ligatures: s.fontVariantLigatures,
      numeric: s.fontVariantNumeric,
    };
  });
}

const FACE = {
  display: /Stardos.?Stencil/i,
  label: /Oswald/i,
  typing: /IBM.?Plex.?Mono/i,
  flavour: /Special.?Elite/i,
  body: /Courier.?Prime/i,
  device: /VT323/i,
} as const;

const MAJOR =
  "At dawn, the Major pins a medal on the fastest typist. The slowest is sent to sort files in the basement.";

test.describe("design system page", () => {
  test("renders every primitive state accessibly", async ({ page }) => {
    await page.goto("/design");
    await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Saving" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Saving" })).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    // Next.js injects a route announcer with role="alert"; always filter alerts by text.
    await expect(page.getByRole("alert").filter({ hasText: "Could not save" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("renders accessibly in the dark scheme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/design");
    await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible();
    const scheme = await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
    expect(scheme).toBe(true);
    await expectNoA11yViolations(page);
  });

  for (const [scheme, bg, fg] of [
    ["light", "rgb(241, 232, 214)", "rgb(42, 36, 32)"],
    ["dark", "rgb(62, 57, 52)", "rgb(244, 236, 220)"],
  ] as const) {
    test(`paints the Fifth Copy ${scheme} ground and ink`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/design");
      const body = await page.evaluate(() => {
        const style = getComputedStyle(document.body);
        return { bg: style.backgroundColor, fg: style.color };
      });
      expect(body).toEqual({ bg, fg });
    });
  }

  test("shows every colour role with its name and the typing and device samples", async ({
    page,
  }) => {
    await page.goto("/design");
    const section = page.getByRole("region", { name: "Colour roles" });
    await expect(section.getByRole("heading", { level: 2, name: "Colour roles" })).toBeVisible();
    const roles = [
      "bg",
      "surface",
      "surface-muted",
      "fg",
      "fg-muted",
      "border",
      "primary",
      "primary-hover",
      "primary-fg",
      "pressed",
      "danger",
      "danger-surface",
      "success",
      "success-surface",
      "focus",
      "link",
      "you",
      "rival",
      "reward",
      "untyped",
      "room",
      "tape",
      "typing-done",
      "typing-next",
      "typing-next-bg",
      "typing-remaining",
      "typing-error",
      "device-phosphor",
      "device-nixie",
      "device-bezel",
    ];
    await expect(section.locator("[data-role]")).toHaveCount(roles.length);
    for (const role of roles) {
      await expect(section.locator(`[data-role="${role}"]`)).toHaveText(role);
    }
    await expect(section.locator('[data-sample="typing"]')).toHaveText("Type fast. Tupe first.");
    await expect(section.locator('[data-sample="device"]')).toBeVisible();
  });

  test("is keyboard navigable with visible focus", async ({ page }) => {
    await page.goto("/design");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus-visible");
    await expect(focused).toHaveText("Primary");
    const outline = await focused.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("has no horizontal overflow", async ({ page }) => {
    await page.goto("/design");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test("#20 C1 C11 type-display: Stardos Stencil 700, caps, 0.06em, sm/md/lg scale", async ({
    page,
  }) => {
    await page.goto("/design");
    const section = page.getByRole("region", { name: "Type roles" });
    for (const [size, px] of [
      ["sm", 24],
      ["md", 36],
      ["lg", 56],
    ] as const) {
      const sample = section.locator(`[data-type-role="display-${size}"]`);
      // display-lg carries a soft hyphen (U+00AD) so PAPERWORK breaks on phones only
      expect((await sample.textContent())?.replace(/\u00AD/g, "").trim()).toBe("HERO OF PAPERWORK");
      const t = await typeOf(sample);
      expect(t.family, size).toMatch(FACE.display);
      expect(t.weight).toBe("700");
      expect(t.transform).toBe("uppercase");
      expect(t.size).toBe(px);
      expect(t.spacing).toBeCloseTo(px * 0.06, 1);
    }
    const cyrillic = section.locator('[data-type-cyrillic="display"]');
    await expect(cyrillic).toHaveText("НАЧАЛИ / GO");
    expect((await typeOf(cyrillic)).stack).toMatch(/Stardos[^,]*,.*Oswald/i);
  });

  test("#20 C2 C11 type-label: Oswald 600, caps, 0.18em, 14px", async ({ page }) => {
    await page.goto("/design");
    const section = page.getByRole("region", { name: "Type roles" });
    const sample = section.locator('[data-type-role="label"]');
    await expect(sample).toHaveText("DOCKET");
    const t = await typeOf(sample);
    expect(t.family).toMatch(FACE.label);
    expect(t.weight).toBe("600");
    expect(t.transform).toBe("uppercase");
    expect(t.size).toBe(14);
    expect(t.spacing).toBeCloseTo(14 * 0.18, 1);
    const cyrillic = section.locator('[data-type-cyrillic="label"]');
    await expect(cyrillic).toHaveText("ОБОГНАЛИ · PASSED");
    expect((await typeOf(cyrillic)).family).toMatch(FACE.label);
  });

  test("#20 C3 type-typing: IBM Plex Mono 400, mixed case, 28-36px, no ligatures", async ({
    page,
  }, info) => {
    await page.goto("/design");
    const sample = page
      .getByRole("region", { name: "Type roles" })
      .locator('[data-type-role="typing"]');
    await expect(sample).toHaveText("« Où est le café ? » Déjà 4 h 30 ; dépêche-toi !");
    const t = await typeOf(sample);
    expect(t.family).toMatch(FACE.typing);
    expect(t.weight).toBe("400");
    expect(t.transform).toBe("none");
    expect(t.size).toBeGreaterThanOrEqual(28);
    expect(t.size).toBeLessThanOrEqual(36);
    if (info.project.name === "mobile") expect(t.size).toBe(28);
    if (info.project.name === "desktop") expect(t.size).toBe(32);
    expect(Number.parseFloat(t.lineHeight)).toBeCloseTo(t.size * 1.4, 1);
    expect(t.ligatures).toBe("none");
  });

  test("#20 C4 C5 flavour, body and device roles with the art-direction samples", async ({
    page,
  }) => {
    await page.goto("/design");
    const section = page.getByRole("region", { name: "Type roles" });
    await expect(section.getByRole("heading", { level: 2, name: "Type roles" })).toBeVisible();

    const flavour = section.locator('[data-type-role="flavour"]');
    await expect(flavour).toHaveText("ASSET NIGHTINGALE MEETS AT 0400.");
    const f = await typeOf(flavour);
    expect(f.family).toMatch(FACE.flavour);
    expect(f.weight).toBe("400");
    expect(f.transform).toBe("none");

    const body = section.locator('[data-type-role="body"]');
    await expect(body).toHaveText(MAJOR);
    const b = await typeOf(body);
    expect(b.family).toMatch(FACE.body);
    expect(b.weight).toBe("400");
    expect(b.size).toBe(16);
    expect(Number.parseFloat(b.lineHeight)).toBeCloseTo(16 * 1.55, 1);

    const device = section.locator('[data-type-role="device"]');
    await expect(device).toHaveText("00 88 66");
    const d = await typeOf(device);
    expect(d.family).toMatch(FACE.device);
    expect(d.numeric).toBe("tabular-nums");
    expect(d.transform).toBe("none");

    for (const role of [
      "type-display-sm",
      "type-display-md",
      "type-display-lg",
      "type-label",
      "type-typing",
      "type-flavour",
      "type-body",
      "type-device",
    ]) {
      await expect(section.getByText(role, { exact: true })).toBeVisible();
    }
  });

  test("#20 C13 buttons use type-label in every variant, 12/14/16px by size", async ({ page }) => {
    await page.goto("/design");
    for (const name of ["Primary", "Secondary", "Ghost", "Danger", "Disabled", "Saving"]) {
      const t = await typeOf(page.getByRole("button", { name, exact: true }));
      expect(t.family, name).toMatch(FACE.label);
      expect(t.weight, name).toBe("600");
      expect(t.transform, name).toBe("uppercase");
      expect(t.spacing, name).toBeCloseTo(t.size * 0.18, 1);
    }
    for (const [name, px] of [
      ["Small", 12],
      ["Medium", 14],
      ["Large", 16],
    ] as const) {
      const t = await typeOf(page.getByRole("button", { name, exact: true }));
      expect(t.size, name).toBe(px);
      expect(t.spacing, name).toBeCloseTo(px * 0.18, 1);
    }
  });

  test("#20 C14 field label in type-label 12px, hint and error in type-body 14px", async ({
    page,
  }) => {
    await page.goto("/design");
    const label = await typeOf(page.locator("label", { hasText: "Email" }));
    expect(label.family).toMatch(FACE.label);
    expect(label.transform).toBe("uppercase");
    expect(label.size).toBe(12);
    for (const text of ["We never share it.", "Name must be at least 2 characters."]) {
      const t = await typeOf(page.getByText(text, { exact: true }));
      expect(t.family, text).toMatch(FACE.body);
      expect(t.size, text).toBe(14);
    }
  });

  test("#20 C15 alert and empty-state titles in type-display-sm, descriptions in type-body", async ({
    page,
  }) => {
    await page.goto("/design");
    for (const title of ["Could not save", "Saved", "Heads up", "No items yet"]) {
      const t = await typeOf(page.getByText(title, { exact: true }));
      expect(t.family, title).toMatch(FACE.display);
      expect(t.transform, title).toBe("uppercase");
      expect(t.size, title).toBe(24);
    }
    for (const text of [
      "Check your connection and try again.",
      "Informational message.",
      "Items you create appear here.",
    ]) {
      const t = await typeOf(page.getByText(text, { exact: true }));
      expect(t.family, text).toMatch(FACE.body);
    }
  });

  test("#20 C16 page headings in display lg/md, intro in type-body", async ({ page }) => {
    await page.goto("/design");
    const h1 = await typeOf(page.getByRole("heading", { level: 1 }));
    expect(h1.family).toMatch(FACE.display);
    expect(h1.size).toBe(56);
    for (const name of ["Colour roles", "Type roles", "Buttons", "Fields", "States", "Motion"]) {
      const t = await typeOf(page.getByRole("heading", { level: 2, name }));
      expect(t.family, name).toMatch(FACE.display);
      expect(t.size, name).toBe(36);
    }
    for (const name of ["Loading", "Empty"]) {
      const t = await typeOf(page.getByRole("heading", { level: 3, name }));
      expect(t.family, name).toMatch(FACE.label);
    }
    const intro = await typeOf(page.locator("[data-intro]"));
    expect(intro.family).toMatch(FACE.body);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`visual baseline (${scheme}) @visual`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await stabilize(page);
      await page.goto("/design");
      await expect(page).toHaveScreenshot(`design-${scheme}.png`, {
        fullPage: true,
        mask: [page.getByRole("status", { name: "Loading" })],
      });
    });
  }
});
