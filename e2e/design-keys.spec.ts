import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";
import { HYDRATION_WAIT } from "./timeouts";

// Contract of #566 C1 and C4: /design/keys records keydown, beforeinput, input and the composition events
// with key, code, isComposing, data and inputType, shows the committed text, and COPY FIXTURE copies the
// fixture JSON with the os / browser / layout / case from the selects; the page is noindex, outside any
// sitemap, and tagged DEV ONLY.

async function open(page: Page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/design/keys");
  await expect(page.locator("[data-key-recorder]")).toHaveAttribute("data-key-recorder", "ready", {
    timeout: HYDRATION_WAIT,
  });
}

test.describe("/design/keys dead-key recorder (#566)", () => {
  test("C4: DEV ONLY tag, noindex, not in the sitemap", async ({ page, request }) => {
    await open(page);
    await expect(page.locator("[data-dev-only]")).toHaveText("DEV ONLY");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("DEAD-KEY RECORDER");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    const sitemap = await request.get("/sitemap.xml");
    if (sitemap.ok()) expect(await sitemap.text()).not.toContain("/design");
    await expect(page.locator("[data-recorder-input]")).toBeFocused();
  });

  test("C1: empty, then recording a key and a composition, then copied", async ({ page }) => {
    await open(page);
    const recorder = page.locator("[data-key-recorder]");
    // empty
    await expect(recorder).toHaveAttribute("data-state", "empty");
    await expect(page.locator("[data-empty]")).toBeVisible();
    await expect(page.getByRole("button", { name: "COPY FIXTURE" })).toBeDisabled();
    await expectNoA11yViolations(page);

    // pick the machine
    await page.locator('[data-select="os"]').selectOption("macos");
    await page.locator('[data-select="browser"]').selectOption("safari");
    await page.locator('[data-select="layout"]').selectOption("fr-ca");
    await page.locator('[data-select="case"]').selectOption("e-acute");
    await expect(page.locator("[data-target]")).toHaveText("TYPE é");

    // recording: a plain key, then a dead-key composition driven through the browser's IME path
    const input = page.locator("[data-recorder-input]");
    await input.focus();
    await page.keyboard.press("a");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "´", selectionStart: 1, selectionEnd: 1 });
    await cdp.send("Input.insertText", { text: "é" });

    await expect(recorder).toHaveAttribute("data-state", "recording");
    await expect(page.locator("[data-committed]")).toHaveText("aé");
    const types = await page
      .locator("[data-log] tbody tr")
      .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-event")));
    expect(types.slice(0, 3)).toEqual(["keydown", "beforeinput", "input"]);
    for (const t of ["compositionstart", "compositionupdate", "compositionend"])
      expect(types).toContain(t);
    const keydown = page.locator('[data-log] tr[data-event="keydown"]').first();
    await expect(keydown.locator('[data-field="key"]')).toHaveText('"a"');
    await expect(keydown.locator('[data-field="code"]')).toHaveText('"KeyA"');
    await expect(keydown.locator('[data-field="isComposing"]')).toHaveText("false");
    await expect(keydown.locator('[data-field="data"]')).toHaveText("null");
    const beforeinput = page.locator('[data-log] tr[data-event="beforeinput"]').first();
    await expect(beforeinput.locator('[data-field="inputType"]')).toHaveText('"insertText"');
    await expect(beforeinput.locator('[data-field="data"]')).toHaveText('"a"');
    await expect(
      page.locator('[data-log] tr[data-event="compositionend"] [data-field="data"]'),
    ).toHaveText('"é"');
    await expect(page.locator("[data-count]")).toHaveText(`${types.length} EVENTS`);
    await expectNoA11yViolations(page);

    // copied
    await page.getByRole("button", { name: "COPY FIXTURE" }).click();
    await expect(recorder).toHaveAttribute("data-state", "copied");
    await expect(page.getByRole("button", { name: "COPIED" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Fixture copied" })).toHaveText(
      "Fixture copied. Save it as macos-fr-ca-e-acute.json.",
    );
    const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    expect(copied).toMatchObject({
      os: "macos",
      browser: "safari",
      layout: "fr-ca",
      case: "e-acute",
      expected: "aé",
    });
    expect(copied.events).toHaveLength(types.length);
    expect(copied.events[0]).toEqual({
      type: "keydown",
      key: "a",
      code: "KeyA",
      isComposing: false,
      data: null,
      inputType: null,
    });
    expect(Object.keys(copied).sort()).toEqual(
      ["browser", "case", "events", "expected", "layout", "os"].sort(),
    );

    // CLEAR goes back to empty
    await page.getByRole("button", { name: "CLEAR" }).click();
    await expect(recorder).toHaveAttribute("data-state", "empty");
    await expect(page.locator("[data-committed]")).toHaveText("");
  });
});
