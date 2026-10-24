/**
 * Test-wait deadlines for e2e specs (#629). These are test waits, not product budgets: a loaded machine
 * (several card worktrees running checks at once) needs longer ones, so every deadline is a base in ms
 * multiplied by `E2E_TIMEOUT_SCALE` (positive number, default 1: an idle run is unchanged).
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
