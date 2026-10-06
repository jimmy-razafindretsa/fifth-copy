import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page, type Request } from "@playwright/test";

export type FailedRequest = {
  errorText: string | undefined;
  /** Request path (no origin), e.g. `/3d/vendor/three.core.min.js`. */
  path: string;
  method: string;
  nextAction: string | null;
  rsc: string | null;
  status: number | null;
  contentType: string | null;
};

/**
 * The one failed request the guard tolerates (#519, work/log/519.md; #107, work/log/107.md):
 * Chromium sometimes reports `net::ERR_ABORTED` on a Flight fetch (server-action POST, or the
 * router's RSC GET after an action redirect) after the server answered it in full (2xx Flight
 * body). The network stack completes the request; only the renderer reports a cancel.
 */
export function isBenignFlightAbort(f: FailedRequest): boolean {
  const flightFetch =
    (f.method === "POST" && !!f.nextAction) || (f.method === "GET" && f.rsc === "1");
  return (
    f.errorText === "net::ERR_ABORTED" &&
    flightFetch &&
    f.status !== null &&
    f.status >= 200 &&
    f.status < 300 &&
    !!f.contentType?.startsWith("text/x-component")
  );
}

/**
 * The landing's 3D embeds (#497) load three.js from `/3d/`; leaving the page mid-load (a lobby
 * navigation) aborts those fetches, which Chromium reports as failures. Nothing else is tolerated.
 */
export function isBenignEmbedAbort(f: FailedRequest): boolean {
  return f.errorText === "net::ERR_ABORTED" && f.method === "GET" && f.path.startsWith("/3d/");
}

/**
 * The live feed's recorded loops (#552): a `<video>` fetches its clip in Range requests and cancels them
 * itself (it reads ahead, then pauses off screen, swaps view or reloads to the poster), which Chromium
 * reports as `net::ERR_ABORTED`. Only GETs of `/media/live-feed/` are tolerated.
 */
export function isBenignMediaAbort(f: FailedRequest): boolean {
  return (
    f.errorText === "net::ERR_ABORTED" &&
    f.method === "GET" &&
    f.path.startsWith("/media/live-feed/")
  );
}

/**
 * Never rejects (#545): a request can fail while its page, context or browser closes (teardown), and
 * reading its headers then throws after the test ended. Every remote read falls back to `null`; the
 * failure itself (`errorText`, url, method) is local, so a genuine failure is still reported.
 */
export async function describeFailure(r: Request): Promise<FailedRequest> {
  const orNull = <T>(p: Promise<T | null> | undefined) =>
    (p ?? Promise.resolve(null)).catch(() => null);
  const response = await orNull(r.response());
  return {
    errorText: r.failure()?.errorText,
    path: new URL(r.url()).pathname,
    method: r.method(),
    nextAction: await orNull(r.headerValue("next-action")),
    rsc: await orNull(r.headerValue("rsc")),
    status: response?.status() ?? null,
    contentType: await orNull(response?.headerValue("content-type")),
  };
}

/**
 * Records console errors, page errors, failed requests and 5xx responses on `page`.
 * `settle` waits for the failed-request checks still in flight and returns `errors`.
 */
export function watchPage(page: Page): { errors: string[]; settle: () => Promise<string[]> } {
  const errors: string[] = [];
  const pending: Promise<void>[] = [];
  // Paths the main document answered 404 for: the page under test is a not-found page (#397), so
  // Chromium's "Failed to load resource" for that document (and the server actions it posts to the
  // same path) is the expected outcome, not a defect. A 404 asset on any page is still flagged.
  const notFoundPaths = new Set<string>();
  const pathOf = (url: string) => {
    try {
      return new URL(url).pathname;
    } catch {
      return null;
    }
  };
  page.on("response", (r) => {
    const req = r.request();
    if (r.status() === 404 && req.isNavigationRequest() && req.frame() === page.mainFrame()) {
      notFoundPaths.add(pathOf(r.url()) ?? "");
    }
  });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const resource = m.text().startsWith("Failed to load resource")
      ? pathOf(m.location().url)
      : null;
    if (resource !== null && notFoundPaths.has(resource)) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) =>
    pending.push(
      describeFailure(r).then((f) => {
        if (!isBenignFlightAbort(f) && !isBenignEmbedAbort(f) && !isBenignMediaAbort(f)) {
          errors.push(`requestfailed: ${r.method()} ${r.url()} ${f.errorText ?? ""}`.trimEnd());
        }
      }),
    ),
  );
  page.on("response", (r) => r.status() >= 500 && errors.push(`http ${r.status()}: ${r.url()}`));
  const settle = async () => {
    await Promise.all(pending);
    return errors;
  };
  return { errors, settle };
}

/**
 * Shared fixture: every test fails on console errors or failed requests (UI role rule:
 * zero console errors, zero failed requests). Use `expectNoA11yViolations` for axe.
 */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const { errors, settle } = watchPage(page);
      await use(errors);
      await settle();
      expect(errors, "console errors / failed requests").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Fails on serious or critical axe violations (WCAG 2.x A/AA). The landing's 3D embeds (`iframe`, a
 * WebGL canvas each) are skipped: axe has nothing to read inside them and crawling busy frames times
 * out under parallel load; their titles are asserted by `e2e/landing.spec.ts`.
 */
export async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude("iframe")
    .analyze();
  const bad = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`);
  expect(bad, "serious/critical axe violations").toEqual([]);
}

/** Freeze time and disable animations before a visual assertion. */
export async function stabilize(page: Page, isoTime = "2026-01-01T12:00:00Z") {
  await page.clock.setFixedTime(new Date(isoTime));
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
  });
}
