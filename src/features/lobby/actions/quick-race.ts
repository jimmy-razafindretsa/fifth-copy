"use server";

import { randomInt } from "node:crypto";
import { limit, requestSubject } from "@/server/limiter";
import { runQuickRace } from "../internal/quick-race";
import type { QuickRaceResult } from "../types";

/** The server's RNG for the bot fill: a draw in [0, 1). */
const serverRng = () => randomInt(2 ** 32) / 2 ** 32;

/**
 * QUICK RACE (#128, R4, R61, R65): seats the caller in the busiest open public room, or opens a
 * public room seated with bots. Takes no input. Every press is checked first against the
 * `quick-race` budget of the request's subject; a refused one creates neither a guest nor a lobby.
 */
export async function quickRace(): Promise<QuickRaceResult> {
  if (!(await limit("quick-race", await requestSubject())).ok) {
    return { ok: false, error: "rate-limited" };
  }
  return runQuickRace(serverRng);
}
