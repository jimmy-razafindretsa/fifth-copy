import { test, expect } from "@playwright/test";
import { isBenignActionAbort, watchPage, type FailedRequest } from "./fixtures";

// #519: the failed-request guard exempts only an aborted server-action POST answered 2xx Flight.
const actionAbort: FailedRequest = {
  errorText: "net::ERR_ABORTED",
  method: "POST",
  nextAction: "4096ae99485ce7f4e760a82b8c9080096cf1f3dc63",
  status: 200,
  contentType: "text/x-component",
};

test.describe("failed-request guard (#519)", () => {
  test("exempts an aborted server-action POST answered 2xx text/x-component", () => {
    expect(isBenignActionAbort(actionAbort)).toBe(true);
  });

  for (const [name, change] of [
    ["another network error", { errorText: "net::ERR_CONNECTION_REFUSED" }],
    ["no error text", { errorText: undefined }],
    ["a GET", { method: "GET" }],
    ["a POST without next-action", { nextAction: null }],
    ["no response", { status: null, contentType: null }],
    ["a 3xx response", { status: 303 }],
    ["a 500 response", { status: 500 }],
    ["an HTML response", { contentType: "text/html; charset=utf-8" }],
    ["no content type", { contentType: null }],
  ] as const) {
    test(`flags ${name}`, () => {
      expect(isBenignActionAbort({ ...actionAbort, ...change })).toBe(false);
    });
  }

  test("a non-action aborted request in the browser is still flagged", async ({ page }) => {
    const origin = "http://guard.test";
    await page.route(`${origin}/`, (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>guard</title>" }),
    );
    await page.route(`${origin}/data`, (route) => route.abort("aborted"));
    await page.route(`${origin}/action`, (route) => route.abort("aborted"));
    await page.goto(`${origin}/`);
    const { settle } = watchPage(page);
    await page.evaluate(async () => {
      await fetch("/data").catch(() => {});
      await fetch("/action", { method: "POST", headers: { "next-action": "x" }, body: "[]" }).catch(
        () => {},
      );
    });
    await expect
      .poll(settle)
      .toEqual([
        `requestfailed: GET ${origin}/data net::ERR_ABORTED`,
        `requestfailed: POST ${origin}/action net::ERR_ABORTED`,
      ]);
  });
});
