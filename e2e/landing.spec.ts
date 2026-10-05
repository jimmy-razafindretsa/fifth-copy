import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";

// Contract of #494: the landing shell (bible 14.1 items 1-2) ported from
// docs/design/bible/Fifth Copy Landing.dc.html. next/font renames families, so they are matched
// by regex; colour roles are resolved to rgb through a probe element.

const KICKER = "MINISTRY OF TYPING · DESK 05 · 1978";
const TAGLINE = "TYPE FAST · TYPE FIRST";
const PITCH =
  "Thirty desks. One message. Everyone types the same copy, and the fastest clean copy gets the medal.";

/** Computed rgb of a colour role, e.g. `role(page, "--color-fg")`; fails on an unemitted variable. */
async function role(page: Page, variable: string): Promise<string> {
  const value = await page.evaluate((v) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${v})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, variable);
  expect(value, variable).not.toMatch(/^rgba\(0, 0, 0, 0\)$/);
  return value;
}

const hero = (page: Page) => page.locator("section").first();

test.describe("landing shell (#494)", () => {
  test("C1 renders the header, then the hero, with no controls", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header");
    await expect(header).toHaveCount(1);
    const monogram = header.locator('img[src="/brand/monogram-red.svg"]');
    await expect(monogram).toHaveAttribute("width", "40");
    await expect(monogram).toHaveAttribute("height", "40");
    expect(await monogram.boundingBox()).toMatchObject({ width: 40, height: 40 });
    await expect(header).toHaveText("FIFTH COPY");
    expect(await header.locator("> *").count()).toBe(1);

    const section = hero(page);
    const headerFirst = await page.evaluate(() => {
      const h = document.querySelector("header");
      const s = document.querySelector("section");
      return !!h && !!s && !!(h.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(headerFirst).toBe(true);
    await expect(section.getByText(KICKER, { exact: true })).toBeVisible();
    await expect(section.getByRole("heading", { level: 1, name: "Fifth Copy" })).toBeVisible();
    await expect(section.getByText(TAGLINE, { exact: true })).toBeVisible();
    await expect(section.getByText(PITCH, { exact: true })).toBeVisible();

    await expect(page.getByText("Start here")).toHaveCount(0);
    // scoped to the page shell: the Next.js dev overlay (shadow DOM) has its own buttons
    const shell = page.locator("header, main");
    await expect(shell.locator("ul")).toHaveCount(0);
    await expect(shell.locator("a, button, form, input, select, textarea")).toHaveCount(0);
  });

  test("C2 styles come from the reference through tokens", async ({ page }) => {
    await page.goto("/");
    const primary = await role(page, "--color-primary");
    const fg = await role(page, "--color-fg");

    const kicker = await hero(page)
      .getByText(KICKER, { exact: true })
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { family: s.fontFamily, spacing: s.letterSpacing, color: s.color };
      });
    expect(kicker.family).toMatch(/Oswald/i);
    expect(kicker.spacing).toBe("3.12px");
    expect(kicker.color).toBe(primary);

    const title = await page
      .locator("header")
      .getByText("FIFTH COPY", { exact: true })
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { family: s.fontFamily, size: s.fontSize };
      });
    expect(title.family).toMatch(/Stardos.?Stencil/i);
    expect(title.size).toBe("20px");

    const pitch = await hero(page)
      .getByText(PITCH, { exact: true })
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { family: s.fontFamily, size: s.fontSize, maxWidth: s.maxWidth };
      });
    expect(pitch.family).toMatch(/Courier.?Prime/i);
    expect(pitch).toMatchObject({ size: "21px", maxWidth: "560px" });

    const border = await page.locator("header").evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.borderBottomWidth, style: s.borderBottomStyle, color: s.borderBottomColor };
    });
    expect(border).toEqual({ width: "2px", style: "solid", color: fg });

    const ground = await hero(page).evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(ground).toContain("radial-gradient");
    expect(ground).toContain("linear-gradient(172deg");
  });

  test("C3 four spinning aria-hidden stars", async ({ page }) => {
    await page.goto("/");
    const stars = await hero(page)
      .locator('[aria-hidden="true"]')
      .evaluateAll((els) =>
        els
          .map((el) => getComputedStyle(el))
          .map((s) => ({ clip: s.clipPath, name: s.animationName, duration: s.animationDuration })),
      );
    expect(stars).toHaveLength(4);
    for (const star of stars) {
      expect(star.clip.replace(/\s+/g, " ")).toMatch(/^polygon\(50% 0%, 61% 35%/);
      // CSS modules scope the keyframes name (`<hash>__fcSpin`)
      expect(star.name).toMatch(/fcSpin$/);
    }
    expect(stars.map((s) => s.duration)).toEqual(["50s", "30s", "24s", "60s"]);
  });

  test("C3 stars stop under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const stars = await hero(page)
      .locator('[aria-hidden="true"]')
      .evaluateAll((els) =>
        els
          .map((el) => getComputedStyle(el))
          .map((s) => ({ name: s.animationName, duration: s.animationDuration })),
      );
    expect(stars).toHaveLength(4);
    for (const star of stars) {
      expect(star.name === "none" || star.duration === "0.01ms", JSON.stringify(star)).toBe(true);
    }
  });

  for (const scheme of ["light", "dark"] as const) {
    const [visible, hidden] =
      scheme === "light"
        ? ["/brand/wordmark-red-on-paper.svg", "/brand/wordmark-red-on-ink.svg"]
        : ["/brand/wordmark-red-on-ink.svg", "/brand/wordmark-red-on-paper.svg"];

    test(`C4 ${scheme}: wordmark variant and page ground`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1.locator(`img[src="${visible}"]`)).toBeVisible();
      await expect(h1.locator(`img[src="${hidden}"]`)).toHaveCSS("display", "none");
      await expect(h1).toHaveAccessibleName("Fifth Copy");
      const bg = await role(page, "--color-bg");
      const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(body).toBe(bg);
    });

    test(`C7 ${scheme}: accessible, no horizontal scroll`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1, name: "Fifth Copy" })).toBeVisible();
      await expectNoA11yViolations(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
