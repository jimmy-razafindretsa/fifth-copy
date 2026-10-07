import type { RaceServerEnv } from "../env";

/**
 * Every timed step of the room lifecycle, in ms (spec 4.1, 5.2, 7.4; ARCHITECTURE 7.1, 7.4). One
 * table: `GRACE_MS` is the reconnection grace of a line-cut desk (#178); idle (#183) adds
 * `IDLE_WARN_MS`, `IDLE_KICK_MS` here. `RACE_FAST_CLOCK=1` (e2e only, ADR 0012) divides each by 10.
 * Wire caps such as `MAX_RACE_MS` are not durations and are never scaled.
 */
const BASE = { COUNTDOWN_MS: 3000, GRACE_MS: 120_000 } as const;

export type Durations = { readonly [K in keyof typeof BASE]: number };

export function durationsFor(env: Pick<RaceServerEnv, "RACE_FAST_CLOCK">): Durations {
  const scale = env.RACE_FAST_CLOCK === "1" ? 10 : 1;
  return { COUNTDOWN_MS: BASE.COUNTDOWN_MS / scale, GRACE_MS: BASE.GRACE_MS / scale };
}
