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
  test("C1 renders the header, then the hero, with only the lobby entries as controls", async ({
    page,
  }) => {
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
    await expect(shell.locator("a, select, textarea")).toHaveCount(0);
    // #99 fills the actions slot: two forms, one field, two buttons
    await expect(shell.locator("form")).toHaveCount(2);
    await expect(shell.locator("input")).toHaveCount(1);
    await expect(shell.locator("button")).toHaveCount(2);
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

// Contract of #99: the lobby entries in the hero actions row (bible 7.1, 7.2, 7.4).
const CREATE = "CREATE PRIVATE RACE";
const JOIN_FIELD = "JOIN WITH CODE";
const JOIN = "JOIN →";

const createButton = (page: Page) => page.getByRole("button", { name: CREATE, exact: true });
const joinForm = (page: Page) => page.getByRole("form", { name: "Join with code" });
const codeField = (page: Page) => joinForm(page).getByLabel(JOIN_FIELD, { exact: true });
const joinButton = (page: Page) => joinForm(page).getByRole("button", { name: JOIN, exact: true });

test.describe("landing lobby entries (#99)", () => {
  test("C1 create and join forms are siblings in the wrapping row after the pitch", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(createButton(page)).toBeVisible();
    await expect(codeField(page)).toBeVisible();
    await expect(joinButton(page)).toBeVisible();
    const layout = await page.evaluate(
      ({ create, pitch }) => {
        const button = [...document.querySelectorAll("button")].find(
          (b) => b.textContent === create,
        );
        const createForm = button?.closest("form");
        const join = document.querySelector('form[aria-label="Join with code"]');
        const pitchEl = [...document.querySelectorAll("p")].find((p) => p.textContent === pitch);
        const row = createForm?.parentElement;
        return {
          onlyButton: createForm?.querySelectorAll("button, input").length,
          siblings: !!row && row === join?.parentElement,
          createFirst: !!(
            createForm &&
            join &&
            createForm.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
          afterPitch: !!(
            pitchEl &&
            row &&
            pitchEl.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
          display: row && getComputedStyle(row).display,
          wrap: row && getComputedStyle(row).flexWrap,
        };
      },
      { create: CREATE, pitch: PITCH },
    );
    expect(layout).toEqual({
      onlyButton: 1,
      siblings: true,
      createFirst: true,
      afterPitch: true,
      display: "flex",
      wrap: "wrap",
    });
  });

  test("C2 the code field masks as you type and uses the code face", async ({ page }) => {
    await page.goto("/");
    const field = codeField(page);
    await field.pressSequentially("kgb4821");
    await expect(field).toHaveValue("KGB-4821");
    await expect(field).toHaveAttribute("maxlength", "8");
    await expect(field).toHaveAttribute("autocapitalize", "characters");
    await expect(field).toHaveAttribute("inputmode", "text");
    await expect(field).toHaveAttribute("spellcheck", "false");
    await expect(field).toHaveAttribute("placeholder", "KGB-4821");
    const font = await field.evaluate((el) => {
      const s = getComputedStyle(el);
      return { family: s.fontFamily, size: s.fontSize, spacing: s.letterSpacing };
    });
    expect(font.family).toMatch(/IBM.?Plex.?Mono/i);
    expect(font).toMatchObject({ size: "18px", spacing: "1.44px" });
  });

  test("C3 a malformed code is rejected inline with no request", async ({ page }) => {
    await page.goto("/");
    const posts: string[] = [];
    page.on("request", (r) => r.method() === "POST" && posts.push(r.url()));
    const field = codeField(page);
    await field.pressSequentially("KG-1");
    await joinButton(page).click();
    const alert = page.getByRole("alert").filter({ hasText: "Enter a code like KGB-4821" });
    await expect(alert).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    const errorId = await alert.getAttribute("id");
    expect(errorId).toBeTruthy();
    await expect(field).toHaveAttribute("aria-describedby", errorId!);
    await page.waitForTimeout(300);
    expect(posts).toEqual([]);
  });

  test("C4 a server error renders the docket error line and the form stays usable", async ({
    page,
  }) => {
    await page.goto("/");
    const primary = await role(page, "--color-primary");
    const fg = await role(page, "--color-fg");
    const surface = await role(page, "--color-surface");
    const field = codeField(page);
    await field.pressSequentially("ZZZ0000");
    await expect(field).toHaveValue("ZZZ-0000");
    await joinButton(page).click();
    const alert = joinForm(page).getByRole("alert").filter({ hasText: "RETURNED ·" });
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText("ZZZ");
    const style = await alert.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        bg: s.backgroundColor,
        color: s.color,
      };
    });
    expect(style).toEqual({ border: `2px solid ${fg}`, bg: surface, color: primary });
    await expect(field).toBeEnabled();
    await expect(joinButton(page)).toBeEnabled();
    await field.fill("");
    await field.pressSequentially("abc");
    await expect(field).toHaveValue("ABC");
  });

  test("C6 controls follow the bible recipe through tokens", async ({ page }) => {
    await page.goto("/");
    const fg = await role(page, "--color-fg");
    const bg = await role(page, "--color-bg");
    const surface = await role(page, "--color-surface");

    const create = await createButton(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        family: s.fontFamily,
        size: s.fontSize,
        spacing: s.letterSpacing,
        border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        bg: s.backgroundColor,
        radius: s.borderRadius,
        shadow: s.boxShadow,
      };
    });
    expect(create.family).toMatch(/Oswald/i);
    expect(create).toMatchObject({
      size: "13px",
      spacing: "2.08px",
      border: `2px solid ${fg}`,
      bg: "rgba(0, 0, 0, 0)",
      radius: "0px",
      shadow: "none",
    });

    const submit = await joinButton(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color };
    });
    expect(submit).toEqual({ bg: fg, color: bg });

    const group = await codeField(page).evaluate((el) => {
      const s = getComputedStyle(el.parentElement!);
      return {
        border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        bg: s.backgroundColor,
      };
    });
    expect(group).toEqual({ border: `2px solid ${fg}`, bg: surface });

    if (test.info().project.name !== "desktop") {
      for (const control of [createButton(page), codeField(page), joinButton(page)]) {
        const box = await control.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    }
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C8 ${scheme}: entries and error line are accessible, no horizontal scroll`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await codeField(page).pressSequentially("KG");
      await joinButton(page).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "Enter a code like KGB-4821" }),
      ).toBeVisible();
      await expectNoA11yViolations(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
