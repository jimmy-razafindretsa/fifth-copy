import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  blockWebSockets,
  hostRoom,
  phaseOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
  warmRace,
} from "./helpers";

// Contract of #442 C1-C3: a school network that blocks WebSocket. The host's context refuses every
// WebSocket (`blockWebSockets`), so its room sockets (lobby and seat) can only reach the race server
// over Socket.IO long-polling. The #366 scenario then runs on that line: the host with one Clerk bot,
// Block mode, a 10-word untimed text, to the Dawn report. The page taps its own polling responses
// (an init script over XMLHttpRequest, which engine.io's polling transport uses in the browser) and
// its keystrokes, so the spec proves every room message arrived over polling and measures what
// polling costs against the 10 Hz budget (ARCHITECTURE quality attributes):
// - snapshot interval: arrival gaps between consecutive snapshots, median <= 200 ms, p95 <= 400 ms;
// - keystroke to acknowledged cursor: from a key's keydown to the arrival of the first snapshot whose
//   own `total` (the exact ack of the keys the server applied, #645) covers it, median <= 300 ms.
// The measured figures are printed (`[#442]` line) and recorded in work/log/442.md.

const RACE_PATH = /\/race\/([0-9a-f-]{36})$/;
const input = (page: Page) => page.getByRole("textbox", { name: "Text to type" });
const ended = (page: Page) => page.locator('[data-seat-status] [data-finished="ended"]');
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");

/** What the page's init script records (`window.__net`). */
type Net = {
  /** Socket.IO event names received over polling, in order. */
  polled: string[];
  /** The page's own desk, from the last `welcome` it polled. */
  you: number | null;
  /** Each polled snapshot: arrival (`performance.now()`), race time, and every desk's tuple. */
  snapshots: { at: number; t: number; desks: number[][] }[];
  /** `performance.now()` of each printable keydown in the typing surface, in order. */
  keys: number[];
};

/** Runs in the page before its scripts: taps polling responses and keydowns. */
function tapNetwork() {
  const net: Net = { polled: [], you: null, snapshots: [], keys: [] };
  (window as unknown as { __net: Net }).__net = net;
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    const url = String(args[1]);
    if (url.includes("/socket.io/") && url.includes("transport=polling")) {
      this.addEventListener("load", () => {
        const at = performance.now();
        // engine.io v4 payload: packets separated by \x1e; a Socket.IO event is `42[...]`.
        for (const packet of String(this.responseText).split("\x1e")) {
          if (!packet.startsWith("42")) continue;
          const [event, payload] = JSON.parse(packet.slice(2)) as [string, Record<string, unknown>];
          net.polled.push(event);
          if (event === "welcome") net.you = payload.you as number;
          if (event === "snapshot")
            net.snapshots.push({ at, t: payload.t as number, desks: payload.desks as number[][] });
        }
      });
    }
    return (open as (...a: unknown[]) => void).apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key.length === 1) net.keys.push(performance.now());
    },
    { capture: true },
  );
}

const quantile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
const median = (values: number[]) =>
  quantile(
    [...values].sort((a, b) => a - b),
    0.5,
  );

test.describe("#442 races over Socket.IO long-polling when WebSocket is blocked", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C1-C3: a Clerk bot race runs to the Dawn report on polling, within the 10 Hz budget", async ({
    browser,
  }) => {
    test.setTimeout(scaled(120_000));
    /** Socket.IO WebSockets the browser opened for the host (must stay none). */
    const roomWebSockets: string[] = [];
    const { host, lobbyId } = await hostRoom(browser, opened, {
      before: async (page) => {
        await blockWebSockets(page);
        await page.addInitScript(tapNetwork);
        await recordRaceTokens(page);
        page.on("websocket", (ws) => {
          if (ws.url().includes("/socket.io/")) roomWebSockets.push(ws.url());
        });
      },
    });
    const net = () => host.evaluate(() => (window as unknown as { __net: Net }).__net);

    // C1: the lobby's room socket reached its welcome over polling.
    await expect.poll(async () => (await net()).polled).toContain("welcome");
    const settings = await setHostSettings(host, {
      errorMode: "block",
      wordCount: 10,
      timerS: null,
      bots: [{ level: "clerk" }],
    });
    expect(settings.bots).toEqual([{ level: "clerk" }]);
    // The lobby roll advances over polling: the bot joins the host's list.
    await expect(
      host.getByRole("list", { name: "Typists in the room" }).getByRole("listitem"),
    ).toHaveCount(2, { timeout: scaled(10_000) });
    await expect(startButton(host)).toBeEnabled({ timeout: scaled(10_000) });

    await warmRace(host, lobbyId);
    await startButton(host).click();
    await expect(host).toHaveURL(RACE_PATH);
    const raceId = RACE_PATH.exec(host.url())![1]!;
    // The countdown advances to GO over polling.
    await expect(phaseOf(host)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(15_000),
    });
    await expect(input(host)).toHaveAttribute("data-mode", "block");
    const text = await stripText(host);
    expect(text.trim().split(/\s+/)).toHaveLength(10);
    const keysBefore = (await net()).keys.length;
    // A steady classroom pace (about 100 WPM), so each key's ack can be timed on its own.
    await host.keyboard.type(text, { delay: 120 });
    await expect(ended(host)).toBeVisible({ timeout: scaled(75_000) });

    const seen = await net();
    // C1/C2: the whole race came over polling; no WebSocket ever opened.
    expect(roomWebSockets).toEqual([]);
    for (const event of ["welcome", "countdown", "snapshot", "ended"])
      expect(seen.polled, `${event} over polling`).toContain(event);
    const you = seen.you!;
    expect(you).toBeGreaterThan(0);
    const last = seen.snapshots.at(-1)!;
    const own = last.desks.find(([desk]) => desk === you)!;
    const bot = last.desks.find(([desk]) => desk !== you)!;
    // C2: the host's strokes and the bot's lane both advanced (cursor = index 1, total = index 5).
    expect(own[5]).toBeGreaterThanOrEqual(text.length);
    expect(bot[1]).toBeGreaterThan(0);

    // C3: latency under polling.
    const running = seen.snapshots.filter((s) => s.t >= 0);
    expect(running.length).toBeGreaterThanOrEqual(30);
    const gaps = running.slice(1).map((s, i) => s.at - running[i]!.at);
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const gapMedian = quantile(sortedGaps, 0.5);
    const gapP95 = quantile(sortedGaps, 0.95);
    const keys = seen.keys.slice(keysBefore);
    expect(keys).toHaveLength(text.length);
    const acks = keys.map((pressed, i) => {
      const ack = running.find(
        (s) => s.at >= pressed && (s.desks.find(([desk]) => desk === you)?.[5] ?? 0) >= i + 1,
      );
      return ack ? ack.at - pressed : Number.POSITIVE_INFINITY;
    });
    const ackMedian = median(acks);
    console.log(
      `[#442] polling: ${running.length} snapshots, interval median ${gapMedian.toFixed(0)} ms` +
        ` p95 ${gapP95.toFixed(0)} ms; keystroke->ack median ${ackMedian.toFixed(0)} ms` +
        ` p95 ${quantile(
          [...acks].sort((a, b) => a - b),
          0.95,
        ).toFixed(0)} ms over ${acks.length} keys`,
    );
    expect(gapMedian).toBeLessThanOrEqual(200);
    expect(gapP95).toBeLessThanOrEqual(400);
    expect(ackMedian).toBeLessThanOrEqual(300);

    // The Dawn report, as in #366.
    const link = host.getByRole("link", { name: "DAWN REPORT →" });
    await expect(link).toHaveAttribute("href", `/results/${raceId}`);
    await link.click();
    await expect(host).toHaveURL(`/results/${raceId}`);
    const rows = host.locator("[data-ranking] tbody tr");
    await expect(rows).toHaveCount(2, { timeout: scaled(15_000) });
    const botRow = rows.filter({ has: host.locator('[data-col="name"]', { hasText: "BOT" }) });
    await expect(botRow).toHaveAttribute("data-status", /finished/i);
  });
});
