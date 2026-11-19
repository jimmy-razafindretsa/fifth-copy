/**
 * Lighthouse mobile performance of one route on the production build (#999 C58, #954).
 *
 *   npm run build && npx tsx scripts/lighthouse.ts / --runs 5 --min 90
 *   npx tsx scripts/lighthouse.ts /welcome --runs 3 --url http://localhost:3000   (a server already up)
 *
 * Without `--url` it starts `next start` on `PORT` (the worktree's `.env`; default 3000) and stops it at
 * the end, so `.next` must hold a production build. Each run gets a fresh, cookieless Chromium (the
 * Playwright build, or `CHROME_PATH`) and Lighthouse's default config: mobile form factor, simulated
 * throttling, the performance category only. One warm-up load first (server caches and compiled routes),
 * then N measured runs; it prints one line per run and the median.
 * Exit: 0 median >= min, 1 below, 2 usage, server or browser failure.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export type Options = { route: string; runs: number; min: number; url: string | null };

class UsageError extends Error {}

const USAGE = "usage: npx tsx scripts/lighthouse.ts <route> [--runs N] [--min SCORE] [--url BASE]";

export function parseArgs(argv: string[]): Options {
  const opts: Options = { route: "", runs: 5, min: 90, url: null };
  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift()!;
    if (arg === "--runs" || arg === "--min") {
      const n = Number(rest.shift());
      if (!Number.isInteger(n) || n < (arg === "--runs" ? 1 : 0) || (arg === "--min" && n > 100))
        throw new UsageError(`${arg} needs ${arg === "--runs" ? "a count >= 1" : "a score 0-100"}`);
      if (arg === "--runs") opts.runs = n;
      else opts.min = n;
    } else if (arg === "--url") {
      const url = rest.shift();
      if (!url || !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url))
        throw new UsageError("--url must be a local origin, e.g. http://localhost:3000");
      opts.url = url;
    } else if (arg.startsWith("/") && !opts.route) {
      opts.route = arg;
    } else {
      throw new UsageError(`unexpected argument ${arg}`);
    }
  }
  if (!opts.route) throw new UsageError("missing route");
  return opts;
}

/** The median of the scores (mean of the two middle ones for an even count), 0-100. */
export function median(scores: number[]): number {
  if (scores.length === 0) throw new RangeError("no scores");
  const s = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error(`no answer from ${url} after ${timeoutMs / 1000}s`);
}

function startServer(port: string): ChildProcess {
  const child = spawn("npx", ["next", "start", "-p", port], {
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  return child;
}

function stopServer(child: ChildProcess) {
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM"); // the npx process group (npx -> next)
    } catch {
      // already gone
    }
  }
}

type Metrics = { score: number; fcp: number; lcp: number; tbt: number; cls: number; si: number };

async function measure(url: string): Promise<Metrics> {
  const [{ default: lighthouse }, { chromium }] = await Promise.all([
    import("lighthouse"),
    import("@playwright/test"),
  ]);
  const port = 9300 + Math.floor(Math.random() * 500);
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    channel: process.env.CHROME_PATH ? undefined : "chromium", // new headless, not the headless shell
    args: [`--remote-debugging-port=${port}`],
  });
  try {
    const result = await lighthouse(url, {
      port,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance"],
    });
    const lhr = result?.lhr;
    const score = lhr?.categories.performance?.score;
    if (!lhr || typeof score !== "number") {
      throw new Error(`no performance score (${lhr?.runtimeError?.message ?? "no report"})`);
    }
    const ms = (id: string) => Math.round(lhr.audits[id]?.numericValue ?? NaN);
    return {
      score: Math.round(score * 100),
      fcp: ms("first-contentful-paint"),
      lcp: ms("largest-contentful-paint"),
      tbt: ms("total-blocking-time"),
      si: ms("speed-index"),
      cls: Number((lhr.audits["cumulative-layout-shift"]?.numericValue ?? NaN).toFixed(3)),
    };
  } finally {
    await browser.close();
  }
}

export async function main(argv: string[]): Promise<number> {
  let opts: Options;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`lighthouse: ${e.message}\n${USAGE}`);
    return 2;
  }
  const port = process.env.PORT || "3000";
  const base = opts.url ?? `http://localhost:${port}`;
  const server = opts.url ? null : startServer(port);
  try {
    await waitFor(`${base}/api/health`, 60_000);
    const url = `${base}${opts.route}`;
    await fetch(url); // warm-up: the first request compiles nothing in production, but fills caches
    const scores: number[] = [];
    for (let i = 1; i <= opts.runs; i++) {
      const m = await measure(url);
      scores.push(m.score);
      console.log(
        `run ${i}/${opts.runs}: ${m.score} (FCP ${m.fcp} ms, LCP ${m.lcp} ms, TBT ${m.tbt} ms, SI ${m.si} ms, CLS ${m.cls})`,
      );
    }
    const med = median(scores);
    const ok = med >= opts.min;
    console.log(
      `lighthouse ${opts.route}: median ${med} of ${opts.runs} mobile runs (min ${opts.min}) ${ok ? "PASS" : "FAIL"}`,
    );
    return ok ? 0 : 1;
  } catch (e) {
    console.error(`lighthouse: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  } finally {
    if (server) stopServer(server);
  }
}

if (process.argv[1] && /[\\/]lighthouse\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e);
      process.exit(2);
    },
  );
}
