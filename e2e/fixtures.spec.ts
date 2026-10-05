import { test, expect } from "@playwright/test";
import { isBenignEmbedAbort, isBenignFlightAbort, watchPage, type FailedRequest } from "./fixtures";

// #519, #107: the failed-request guard exempts only an aborted Flight fetch (server-action POST or
// RSC GET) answered 2xx text/x-component.
const actionAbort: FailedRequest = {
  errorText: "net::ERR_ABORTED",
  path: "/",
  method: "POST",
  nextAction: "4096ae99485ce7f4e760a82b8c9080096cf1f3dc63",
  rsc: null,
  status: 200,
  contentType: "text/x-component",
};
const rscAbort: FailedRequest = { ...actionAbort, method: "GET", nextAction: null, rsc: "1" };

test.describe("failed-request guard (#519)", () => {
  test("exempts an aborted server-action POST answered 2xx text/x-component", () => {
    expect(isBenignFlightAbort(actionAbort)).toBe(true);
  });

  for (const [name, change] of [
    ["another network error", { errorText: "net::ERR_CONNECTION_REFUSED" }],
    ["no error text", { errorText: undefined }],
    ["a GET without rsc", { method: "GET" }],
    ["a POST without next-action", { nextAction: null }],
    ["no response", { status: null, contentType: null }],
    ["a 3xx response", { status: 303 }],
    ["a 500 response", { status: 500 }],
    ["an HTML response", { contentType: "text/html; charset=utf-8" }],
    ["no content type", { contentType: null }],
  ] as const) {
    test(`flags ${name}`, () => {
      expect(isBenignFlightAbort({ ...actionAbort, ...change })).toBe(false);
    });
  }

  test("exempts an aborted RSC GET answered 2xx text/x-component", () => {
    expect(isBenignFlightAbort(rscAbort)).toBe(true);
  });

  // #497: an embed asset fetch cut short by leaving the landing is benign; anything else is not
  const embedAbort: FailedRequest = {
    errorText: "net::ERR_ABORTED",
    path: "/3d/vendor/three.core.min.js",
    method: "GET",
    nextAction: null,
    rsc: null,
    status: null,
    contentType: null,
  };
  test("exempts an aborted GET of a /3d/ embed asset", () => {
    expect(isBenignEmbedAbort(embedAbort)).toBe(true);
    expect(isBenignFlightAbort(embedAbort)).toBe(false);
  });
  for (const [name, change] of [
    ["another path", { path: "/brand/monogram-red.svg" }],
    ["another network error", { errorText: "net::ERR_CONNECTION_REFUSED" }],
    ["a POST", { method: "POST" }],
  ] as const) {
    test(`flags ${name} as an embed abort`, () => {
      expect(isBenignEmbedAbort({ ...embedAbort, ...change })).toBe(false);
    });
  }

  for (const [name, change] of [
    ["a GET rsc with another network error", { errorText: "net::ERR_FAILED" }],
    ["a GET with rsc other than 1", { rsc: "0" }],
    ["a GET rsc answered HTML", { contentType: "text/html; charset=utf-8" }],
    ["a GET rsc 500", { status: 500 }],
    ["a GET rsc with no response", { status: null, contentType: null }],
    ["a POST with rsc but no next-action", { method: "POST" }],
  ] as const) {
    test(`flags ${name}`, () => {
      expect(isBenignFlightAbort({ ...rscAbort, ...change })).toBe(false);
    });
  }

  // #397: the not-found page's own 404 is expected; a 404 asset on a page is not
  test("tolerates the 404 of the document under test, not of its assets", async ({ page }) => {
    const origin = "http://guard.test";
    await page.route(`${origin}/missing`, (route) =>
      route.fulfill({
        status: 404,
        contentType: "text/html",
        body: "<!doctype html><title>404</title>",
      }),
    );
    await page.route(`${origin}/`, (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>ok</title>" }),
    );
    await page.route(`${origin}/gone.png`, (route) => route.fulfill({ status: 404, body: "" }));
    const { settle } = watchPage(page);
    await page.goto(`${origin}/missing`);
    await expect.poll(settle).toEqual([]);
    await page.goto(`${origin}/`);
    await page.evaluate(() => fetch("/gone.png").catch(() => {}));
    await expect
      .poll(settle)
      .toContain(
        "console: Failed to load resource: the server responded with a status of 404 (Not Found)",
      );
  });

  test("an aborted request with no response in the browser is still flagged", async ({ page }) => {
    const origin = "http://guard.test";
    await page.route(`${origin}/`, (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>guard</title>" }),
    );
    await page.route(`${origin}/data`, (route) => route.abort("aborted"));
    await page.route(`${origin}/action`, (route) => route.abort("aborted"));
    await page.route(`${origin}/rsc`, (route) => route.abort("aborted"));
    await page.goto(`${origin}/`);
    const { settle } = watchPage(page);
    await page.evaluate(async () => {
      await fetch("/data").catch(() => {});
      await fetch("/action", { method: "POST", headers: { "next-action": "x" }, body: "[]" }).catch(
        () => {},
      );
      await fetch("/rsc", { headers: { rsc: "1" } }).catch(() => {});
    });
    await expect
      .poll(settle)
      .toEqual([
        `requestfailed: GET ${origin}/data net::ERR_ABORTED`,
        `requestfailed: POST ${origin}/action net::ERR_ABORTED`,
        `requestfailed: GET ${origin}/rsc net::ERR_ABORTED`,
      ]);
  });
});
