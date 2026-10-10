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

type Page = import("@playwright/test").Page;

/** The computed value of `prop` for `var(--color-<role>)`, read from a probe so mixes serialize alike. */
async function roleValue(
  page: Page,
  role: string,
  prop: "backgroundColor" | "color" | "borderTopColor",
) {
  return page.evaluate(
    ([r, p]) => {
      const probe = document.createElement("div");
      probe.style.borderStyle = "solid";
      probe.style[p as "color"] = `var(--color-${r})`;
      document.body.append(probe);
      const v = getComputedStyle(probe)[p as "color"];
      probe.remove();
      return v;
    },
    [role, prop] as const,
  );
}

/** The printed-look properties of the first element of `locator` (#15). */
async function lookOf(locator: Locator) {
  return locator.first().evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      bg: s.backgroundColor,
      bgImage: s.backgroundImage,
      color: s.color,
      border: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
      borderStyle: s.borderTopStyle,
      borderColor: s.borderTopColor,
      borderLeftColor: s.borderLeftColor,
      radius: s.borderTopLeftRadius,
      shadow: s.boxShadow,
      decoration: s.textDecorationLine,
      translate: s.translate,
      transform: s.transform,
      animation: s.animationName,
      outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth,
      outlineColor: s.outlineColor,
    };
  });
}

const TWO = ["2px", "2px", "2px", "2px"];
const NONE = ["0px", "0px", "0px", "0px"];

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
      "sheet",
      "machine-paper",
      "machine-deck",
      "machine-ink",
      "machine-metal",
      "machine-muted",
      // #560 the nixie tube glow and the race card's checkered finish
      "device-nixie-glow",
      "finish-ink",
      "finish-paper",
    ];
    await expect(section.locator("[data-role]")).toHaveCount(roles.length);
    for (const role of roles) {
      await expect(section.locator(`[data-role="${role}"]`)).toHaveText(role);
    }
    await expect(section.locator('[data-sample="typing"]')).toHaveText("Type fast. Tupe first.");
    await expect(section.locator('[data-sample="device"]')).toBeVisible();
  });

  test("#24 C6 Brand: wordmarks on their grounds, tagline, monogram ladder, clear-space outline", async ({
    page,
  }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/design");
      const section = page.getByRole("region", { name: "Brand" });
      await expect(section.getByRole("heading", { level: 2, name: "Brand" })).toBeVisible();
      for (const [ground, role, mark] of [
        ["paper", "band-fg", "wordmark-red-on-paper"],
        ["red", "primary", "wordmark-ink-on-red"],
        ["ink", "band", "wordmark-red-on-ink"],
      ] as const) {
        const plate = section
          .locator('[data-brand-demo="wordmarks"]')
          .locator(`[data-plate="${ground}"]`);
        await expect(plate.locator(`svg[data-mark="${mark}"]`)).toBeVisible();
        const bg = await plate.evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(bg, `${scheme} ${ground}`).toBe(await roleValue(page, role, "backgroundColor"));
      }
      const tagline = section.locator('[data-brand-demo="tagline"] svg[data-mark]');
      await expect(tagline).toHaveAttribute("data-mark", "wordmark-tagline-red-on-paper");
      const box = await tagline.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(240);
      const monograms = section.locator('[data-brand-demo="monograms"] svg[data-brand="monogram"]');
      await expect(monograms).toHaveCount(9);
      for (const tile of ["paper", "red", "ink"]) {
        for (const size of [16, 32, 64]) {
          const m = section.getByRole("img", { name: `FC monogram, ${tile} tile, ${size} px` });
          const b = await m.boundingBox();
          expect([b!.width, b!.height]).toEqual([size, size]);
        }
      }
      const outlined = section.locator('[data-brand-demo="clear-space"] svg');
      await expect(outlined).toHaveAttribute("data-clear-space", /^[1-9]/);
      expect(await outlined.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("dashed");
      await expectNoA11yViolations(page);
    }
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
    for (const name of [
      "Colour roles",
      "Type roles",
      "Brand",
      "Buttons",
      "Fields",
      "States",
      "Motion",
    ]) {
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
      // the page is long (the #558 typing-surface specimens): six full-page shots in parallel in the
      // pinned image's software renderer outgrow the 30s test budget on a busy machine (no tolerance change)
      test.slow();
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await stabilize(page);
      await page.goto("/design");
      await expect(page).toHaveScreenshot(`design-${scheme}.png`, {
        fullPage: true,
        // two full-page shots that must match need more than 5s in that renderer
        timeout: 45_000,
        mask: [page.getByRole("status", { name: "Loading" })],
      });
    });
  }
});

test.describe("#15 printed look", () => {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(scheme, () => {
      test.beforeEach(async ({ page }) => {
        // reduced motion zeroes the transition tokens, so hover and active read their final colours
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.goto("/design");
      });

      test("C13 C15 button variants: fills, 2px ink rules, no radius, no shadow, pressed = banner", async ({
        page,
      }) => {
        const role = (
          r: string,
          p: "backgroundColor" | "color" | "borderTopColor" = "backgroundColor",
        ) => roleValue(page, r, p);
        const btn = (name: string) => page.getByRole("button", { name, exact: true });
        const fg = await role("fg", "color");
        const transparent = "rgba(0, 0, 0, 0)";

        const primary = await lookOf(btn("Primary"));
        expect(primary.bg).toBe(await role("primary"));
        expect(primary.color).toBe(await role("primary-fg", "color"));
        expect(primary.border).toEqual(TWO);
        expect(primary.borderStyle).toBe("solid");
        expect(primary.borderColor).toBe(fg);

        const secondary = await lookOf(btn("Secondary"));
        expect(secondary.bg).toBe(transparent);
        expect(secondary.color).toBe(fg);
        expect(secondary.border).toEqual(TWO);
        expect(secondary.borderColor).toBe(fg);

        const ghost = await lookOf(btn("Ghost"));
        expect(ghost.bg).toBe(transparent);
        expect(ghost.color).toBe(fg);
        expect(ghost.border).toEqual(NONE);
        expect(ghost.decoration).toBe("none");

        const danger = await lookOf(btn("Danger"));
        expect(danger.bg).toBe(await role("pressed"));
        expect(danger.bg).not.toBe(primary.bg);
        expect(danger.color).toBe(await role("primary-fg", "color"));
        expect(danger.border).toEqual(TWO);
        expect(danger.borderColor).toBe(fg);

        for (const name of ["Primary", "Secondary", "Ghost", "Danger", "Small", "Large"]) {
          const look = await lookOf(btn(name));
          expect(look.radius, name).toBe("0px");
          expect(look.shadow, name).toBe("none");
        }

        await btn("Primary").hover();
        expect((await lookOf(btn("Primary"))).bg).toBe(await role("primary-hover"));
        expect((await lookOf(btn("Primary"))).shadow).toBe("none");
        await btn("Secondary").hover();
        expect((await lookOf(btn("Secondary"))).bg).toBe(await role("surface"));
        await btn("Ghost").hover();
        expect((await lookOf(btn("Ghost"))).decoration).toBe("underline");

        await btn("Primary").hover();
        await page.mouse.down();
        const pressed = await lookOf(btn("Primary"));
        await page.mouse.up();
        expect(pressed.bg).toBe(await role("pressed"));
        expect(pressed.translate).toBe("0px 1px");
        expect(pressed.shadow).toBe("none");
      });

      test("C13 C16 card, field, alert, skeleton and empty state", async ({ page }) => {
        const role = (
          r: string,
          p: "backgroundColor" | "color" | "borderTopColor" = "backgroundColor",
        ) => roleValue(page, r, p);
        const fg = await role("fg", "color");

        const card = await lookOf(
          page.getByRole("heading", { level: 3, name: "Loading" }).locator(".."),
        );
        expect(card.bg).toBe(await role("surface"));
        expect(card.border).toEqual(TWO);
        expect(card.borderStyle).toBe("solid");
        expect(card.borderColor).toBe(fg);
        expect(card.radius).toBe("0px");
        expect(card.shadow).toBe("none");

        const email = await lookOf(page.getByRole("textbox", { name: "Email" }));
        expect(email.bg).toBe(await role("bg"));
        expect(email.border).toEqual(TWO);
        expect(email.borderStyle).toBe("solid");
        expect(email.borderColor).toBe(fg);
        expect(email.radius).toBe("0px");
        expect(email.shadow).toBe("none");
        const invalid = await lookOf(page.getByRole("textbox", { name: "Name" }));
        expect(invalid.border).toEqual(TWO);
        expect(invalid.borderColor).toBe(await role("danger", "borderTopColor"));

        for (const [locator, tone] of [
          [page.getByRole("alert").filter({ hasText: "Could not save" }), "danger-surface"],
          [page.getByRole("status").filter({ hasText: "Saved" }), "success-surface"],
          [page.getByRole("status").filter({ hasText: "Heads up" }), "surface-muted"],
        ] as const) {
          const alert = await lookOf(locator);
          expect(alert.bg, tone).toBe(await role(tone));
          expect(alert.border, tone).toEqual(TWO);
          expect(alert.borderStyle, tone).toBe("solid");
          expect(alert.borderColor, tone).toBe(fg);
          expect(alert.borderLeftColor, `${tone}: no left rule`).toBe(fg);
          expect(alert.radius, tone).toBe("0px");
          expect(alert.shadow, tone).toBe("none");
        }

        const skeleton = await lookOf(
          page.locator('[aria-label="Loading items"] > div[aria-hidden="true"]'),
        );
        expect(skeleton.bg).toBe(await role("surface-muted"));
        expect(skeleton.bgImage).toBe("none");
        expect(skeleton.animation).toBe("none");
        expect(skeleton.radius).toBe("0px");

        const title = page.getByText("No items yet", { exact: true });
        const empty = await lookOf(title.locator(".."));
        expect(empty.border).toEqual(TWO);
        expect(empty.borderStyle).toBe("dashed");
        expect(empty.borderColor).toBe(await role("border", "borderTopColor"));
        expect(empty.radius).toBe("0px");
        expect((await lookOf(title)).color).toBe(fg);
        expect(
          (await lookOf(page.getByText("Items you create appear here.", { exact: true }))).color,
        ).toBe(await role("fg-muted", "color"));
      });

      test("C17 every interactive primitive shows a 2px focus outline in the focus role", async ({
        page,
      }) => {
        const focus = await roleValue(page, "focus", "color");
        const names: string[] = [];
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press("Tab");
          const el = page.locator(":focus-visible");
          const look = await lookOf(el);
          const name = await el.evaluate(
            (n) => n.getAttribute("aria-label") ?? n.textContent ?? n.id,
          );
          names.push(name);
          expect(look.outlineStyle, name).toBe("solid");
          expect(look.outlineWidth, name).toBe("2px");
          expect(look.outlineColor, name).toBe(focus);
        }
        expect(names.slice(0, 4)).toEqual(["Primary", "Secondary", "Ghost", "Danger"]);
      });
    });
  }
});

/** Computed motif styles of `[data-motif=name]` or one of its descendants (#25). */
async function motifStyle(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        bgImage: s.backgroundImage,
        bgSize: s.backgroundSize,
        textShadow: s.textShadow,
        color: s.color,
        transform: s.transform,
      };
    });
}

const PLATES = {
  grain: '[data-plate="paper-grain"]',
  red: '[data-plate="paper-grain-red"]',
  rays: '[data-plate="sun-rays"]',
} as const;

test.describe("#25 printed motifs", () => {
  test("C6 /design demonstrates every motif in a Printed motifs section", async ({ page }) => {
    await page.goto("/design");
    const section = page.getByRole("region", { name: "Printed motifs" });
    await expect(section.getByRole("heading", { level: 2, name: "Printed motifs" })).toBeVisible();
    for (const motif of [
      "paper-grain",
      "paper-grain-red",
      "misregister",
      "band",
      "stars",
      "sun-rays",
      "device",
      "device-outside",
    ]) {
      await expect(section.locator(`[data-motif="${motif}"]`), motif).toBeVisible();
    }
    await expect(section.locator('[data-motif="misregister"] .type-display-lg')).toHaveClass(
      /ink-misregister/,
    );
    await expect(section.locator('[data-motif="band"] [data-band-upright]')).toHaveText(
      "Room 457 · 30 seats",
    );
    await expect(
      section.locator('[data-motif="stars"] > div > div[aria-hidden="true"]'),
    ).toHaveCount(2);
    await expect(section.locator('[data-motif="sun-rays"]')).toContainText("character-stage");
    const nixie = section.locator('[data-motif="device"] [data-device="nixie"]');
    const phosphor = section.locator('[data-motif="device"] [data-device="phosphor"]');
    await expect(nixie).toHaveText("00 88 66");
    await expect(phosphor).toHaveText("READY");
  });

  for (const scheme of ["light", "dark"] as const) {
    test.describe(scheme, () => {
      test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.goto("/design");
      });

      test("C1 grains paint the bible 6 halftones, opt-in, never on body; axe clean", async ({
        page,
      }) => {
        const grain = await motifStyle(page, PLATES.grain);
        expect(grain.bgImage).toContain("radial-gradient");
        expect(grain.bgSize).toBe("10px 10px");
        const red = await motifStyle(page, PLATES.red);
        expect(red.bgImage).toContain("radial-gradient");
        expect(red.bgSize).toBe("11px 11px");
        expect(red.bgImage).not.toBe(grain.bgImage);
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundImage)).toBe(
          "none",
        );
        // the pattern is a background layer: a hit test at the label lands on the label, not on it
        for (const plate of [PLATES.grain, PLATES.red]) {
          const label = page.locator(`${plate} p`);
          await label.scrollIntoViewIfNeeded();
          const hit = await label.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.textContent;
          });
          expect(hit, plate).toBe(await label.textContent());
        }
        await expectNoA11yViolations(page);
      });

      test("C2 ink-misregister: a 1px primary text-shadow, same red in both themes", async ({
        page,
      }) => {
        const title = await motifStyle(page, '[data-motif="misregister"] .ink-misregister');
        expect(title.textShadow).toBe("rgb(184, 29, 36) 1px 1px 0px");
      });

      test("C3 the band is rotated 38 degrees", async ({ page }) => {
        const strip = await motifStyle(page, '[data-motif="band"] [data-band-strip]');
        const m = /matrix\(([^)]+)\)/.exec(strip.transform);
        expect(m, strip.transform).not.toBeNull();
        const [a, b] = m![1]!.split(",").map(Number) as [number, number];
        const deg = (Math.atan2(b, a) * 180) / Math.PI;
        expect(Math.abs(deg - 38)).toBeLessThanOrEqual(0.5);
        await expect(page.locator('[data-motif="band"] [data-band-angle]')).toHaveAttribute(
          "data-band-angle",
          "38",
        );
      });

      test("C4 sun-rays paints the bible 6 conic recipe", async ({ page }) => {
        expect((await motifStyle(page, PLATES.rays)).bgImage).toContain("repeating-conic-gradient");
      });

      test("C5 device glow only inside [data-device]", async ({ page }) => {
        for (const tone of ["nixie", "phosphor"] as const) {
          const inside = await motifStyle(page, `[data-device="${tone}"]`);
          expect(inside.textShadow, tone).not.toBe("none");
          expect(inside.textShadow, tone).toContain("0px 0px 6px");
          expect(inside.color, tone).toBe(await roleValue(page, `device-${tone}`, "color"));
        }
        const outside = await motifStyle(page, '[data-motif="device-outside"] .device-phosphor');
        expect(outside.textShadow).toBe("none");
        const around = await motifStyle(page, '[data-motif="device-outside"] p');
        expect(outside.color).toBe(around.color);
        expect(outside.color).toBe(await roleValue(page, "fg", "color"));
      });

      test("C7 under prefers-contrast: more the textures paint nothing; misregistration and glow stay", async ({
        page,
      }) => {
        await page.emulateMedia({ contrast: "more" });
        for (const plate of Object.values(PLATES)) {
          expect((await motifStyle(page, plate)).bgImage, plate).toBe("none");
        }
        expect(
          (await motifStyle(page, '[data-motif="misregister"] .ink-misregister')).textShadow,
        ).toBe("rgb(184, 29, 36) 1px 1px 0px");
        expect((await motifStyle(page, '[data-device="nixie"]')).textShadow).toContain(
          "0px 0px 6px",
        );
      });
    });
  }
});

test.describe("#26 stamps", () => {
  const BRAND = /^(Stardos Stencil|Oswald|IBM Plex Mono|Special Elite|Courier Prime|VT323)\b/i;

  /** Font families (with glyph counts) that drew each stamp's text, through Chromium's CDP. */
  async function stampFonts(page: Page) {
    await page.evaluate(() => document.fonts.ready);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: "[data-stamp-tone] span",
    });
    const fonts: { familyName: string; isCustomFont: boolean; glyphCount: number }[] = [];
    for (const nodeId of nodeIds) {
      fonts.push(...(await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts);
    }
    await cdp.detach();
    return fonts;
  }

  for (const scheme of ["light", "dark"] as const) {
    test(`C6 the Stamps section shows ink and red bilingual stamps, axe clean (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/design");
      const section = page.getByRole("region", { name: "Stamps" });
      await expect(section.getByRole("heading", { level: 2, name: "Stamps" })).toBeVisible();
      // several live regions on the page (and the route announcer): always filter by text
      const go = section.getByRole("status").filter({ hasText: "НАЧАЛИ / GO" });
      const overtake = section.getByRole("status").filter({ hasText: "ОБГОН! · OVERTAKE" });
      const passed = section.getByRole("status").filter({ hasText: "ОБОГНАЛИ · PASSED" });
      await expect(go).toHaveAttribute("data-stamp-tone", "red");
      await expect(overtake).toHaveAttribute("data-stamp-tone", "red");
      await expect(overtake).toContainText("DÉPASSEMENT");
      await expect(passed).toHaveAttribute("data-stamp-tone", "ink");
      for (const [stamp, ru] of [
        [go, "НАЧАЛИ"],
        [overtake, "ОБГОН!"],
        [passed, "ОБОГНАЛИ"],
      ] as const) {
        await expect(stamp.locator('span[lang="ru"]')).toHaveText(ru);
      }
      // red = link text on a primary rule, ink = fg text and rule (bible 7.3, #107, #26)
      for (const [stamp, text, rule] of [
        [go, "link", "primary"],
        [passed, "fg", "fg"],
      ] as const) {
        const look = await stamp.evaluate((el) => {
          const s = getComputedStyle(el);
          return { color: s.color, border: s.borderTopColor, style: s.borderTopStyle };
        });
        expect(look.color).toBe(await roleValue(page, text, "color"));
        expect(look.border).toBe(await roleValue(page, rule, "borderTopColor"));
        expect(look.style).toBe("double");
      }
      await expectNoA11yViolations(page);
    });
  }

  test("C6 Replay remounts the stamp", async ({ page }) => {
    await page.goto("/design");
    const demo = page.locator("[data-stamp-demo]");
    await page.waitForFunction(() =>
      Object.keys(document.querySelector("[data-stamp-demo]") ?? {}).some((k) =>
        k.startsWith("__reactFiber"),
      ),
    );
    await demo.locator("[data-stamp-tone]").evaluate((el) => el.setAttribute("data-old", ""));
    await demo.getByRole("button", { name: "Replay" }).click();
    await expect(demo).toHaveAttribute("data-stamp-run", "1");
    await expect(demo.locator("[data-stamp-tone]")).toHaveCount(1);
    await expect(demo.locator("[data-old]")).toHaveCount(0);
    await expect(demo.getByRole("status")).toContainText("ОБГОН! · OVERTAKE");
  });

  test("C6 every stamp glyph is drawn by a brand face (#20)", async ({ page }) => {
    await page.goto("/design");
    await expect
      .poll(async () =>
        (await stampFonts(page))
          .filter((f) => f.glyphCount > 0 && (!f.isCustomFont || !BRAND.test(f.familyName)))
          .map((f) => f.familyName),
      )
      .toEqual([]);
    const fonts = await stampFonts(page);
    expect(fonts.reduce((n, f) => n + f.glyphCount, 0)).toBeGreaterThan(0);
    expect(fonts.some((f) => /Stardos Stencil/i.test(f.familyName))).toBe(true);
    expect(fonts.some((f) => /Oswald/i.test(f.familyName))).toBe(true);
  });
});
