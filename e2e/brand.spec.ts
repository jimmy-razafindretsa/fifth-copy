import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";

// #24 C5: the FC monogram is the site icon; the app is named Fifth Copy.
test.describe("site icons and app name", () => {
  test("serve icon.svg (the brand file), apple-icon.png and favicon.ico", async ({ request }) => {
    const svg = await request.get("/icon.svg");
    expect(svg.status()).toBe(200);
    expect(svg.headers()["content-type"]).toMatch(/^image\/svg\+xml/);
    expect(await svg.text()).toBe(readFileSync("public/brand/monogram-paper.svg", "utf8"));

    const apple = await request.get("/apple-icon.png");
    expect(apple.status()).toBe(200);
    expect(apple.headers()["content-type"]).toMatch(/^image\/png/);

    const favicon = await request.get("/favicon.ico");
    expect(favicon.status()).toBe(200);
  });

  test("/ keeps its catalogue title, names the app and links the icons", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/fifth copy/i);
    await expect(page.locator('meta[name="application-name"]')).toHaveAttribute(
      "content",
      "Fifth Copy",
    );
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
      "href",
      /^\/icon\.svg/,
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      /^\/apple-icon\.png/,
    );
  });
});

// #24 C4: every padded mark keeps one bar height (scaled to its rendered size) clear on every side.
test("brand marks reserve their clear space at the rendered size", async ({ page }) => {
  await page.goto("/design");
  const marks = page.locator('svg[data-brand]:not([data-clear-space="0"])');
  expect(await marks.count()).toBeGreaterThanOrEqual(5);
  const insets = await marks.evaluateAll((svgs) =>
    svgs.map((svg) => {
      const box = svg.getBoundingClientRect();
      const vbWidth = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
      const clear = (Number(svg.getAttribute("data-clear-space")) * box.width) / vbWidth;
      const rects = [...svg.querySelectorAll("path")].map((p) => p.getBoundingClientRect());
      const ink = {
        left: Math.min(...rects.map((r) => r.left)),
        top: Math.min(...rects.map((r) => r.top)),
        right: Math.max(...rects.map((r) => r.right)),
        bottom: Math.max(...rects.map((r) => r.bottom)),
      };
      return {
        mark: svg.getAttribute("data-mark"),
        clear,
        sides: [
          ink.left - box.left,
          ink.top - box.top,
          box.right - ink.right,
          box.bottom - ink.bottom,
        ],
      };
    }),
  );
  for (const { mark, clear, sides } of insets) {
    expect(clear, `${mark}`).toBeGreaterThan(0);
    for (const side of sides) expect(side, `${mark}`).toBeGreaterThanOrEqual(clear - 0.5);
  }
});
