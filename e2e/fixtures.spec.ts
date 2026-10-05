import { test, expect } from "@playwright/test";
import { isBenignFlightAbort, watchPage, type FailedRequest } from "./fixtures";

// #519, #107: the failed-request guard exempts only an aborted Flight fetch (server-action POST or
// RSC GET) answered 2xx text/x-component.
const actionAbort: FailedRequest = {
  errorText: "net::ERR_ABORTED",
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
