/**
 * Test-wait deadlines for e2e specs (#629). These are test waits, not product budgets: a loaded machine
 * (several card worktrees running checks at once) needs longer ones, so every deadline is a base in ms
 * multiplied by `E2E_TIMEOUT_SCALE` (positive number, default 1: an idle run is unchanged).
 *
 * Rule (#681): this is the only file under `e2e/` that may hold a literal deadline. Specs and helpers
 * write `{ timeout: scaled(N) }`, `test.setTimeout(scaled(N))`, `HYDRATION_WAIT`, `ACTION_WAIT` or a new
 * named export here with a one-line doc of what it waits for; `src/lib/e2e-timeouts.test.ts` fails on any
 * `timeout: <number>`, `setTimeout(<number>)` or `.timeout(<number>)` elsewhere. Deliberate pauses
 * (`page.waitForTimeout(N)`) are not deadlines and stay literal.
 */
export function timeoutScale(raw = process.env.E2E_TIMEOUT_SCALE): number {
  const scale = Number(raw);
  return raw && Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** `baseMs` scaled by `E2E_TIMEOUT_SCALE`, e.g. `{ timeout: scaled(20_000) }`. */
export function scaled(baseMs: number): number {
  return Math.round(baseMs * timeoutScale());
}

/** Hydration gate on a dev server that compiles the route on first request. */
export const HYDRATION_WAIT = scaled(30_000);
/** A server-action re-render, or a client effect that follows a user action. */
export const ACTION_WAIT = scaled(20_000);

/**
 * #926 C6: how far apart two pages of one room may turn `running` (their seats' GO), measured on this
 * machine's clock. A tolerance, scaled like the waits: a loaded machine renders the GO late.
 */
export const SAME_START_TOLERANCE = scaled(500);
/**
 * #926: the race server's readiness limit in this run (`LOAD_LIMIT_MS`, 30 s; 3 s with
 * `RACE_FAST_CLOCK=1`), the longest a started room waits for its seats before its countdown.
 */
export const LOAD_LIMIT_MS = process.env.RACE_FAST_CLOCK === "1" ? 3_000 : 30_000;
/**
 * #926 C6: how long the guest's move to `/race/*` is held: longer than the countdown, shorter than the
 * load limit (4 s; 2 s with `RACE_FAST_CLOCK=1`).
 */
export const HOLD_MS = process.env.RACE_FAST_CLOCK === "1" ? 2_000 : 4_000;
