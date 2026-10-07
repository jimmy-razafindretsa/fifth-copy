import type { StartRaceRequest, StartRaceResponse } from "@fifth-copy/protocol";

/**
 * The race server's port to the web app's internal API (ADR 0006 point 6). The HMAC HTTP
 * implementation lands with #199; it rejects on any transport error, non-200 or unparsable body.
 */
export type WebApi = {
  /** `POST /api/internal/races`: creates the Race row and picks the text. Idempotent on `raceId`. */
  startRace(request: StartRaceRequest): Promise<StartRaceResponse>;
};

/** Wired by main.ts until #199: every start is refused (`start-failed`), nothing is half-started. */
export const unavailableWebApi: WebApi = {
  startRace: () => Promise.reject(new Error("web api not wired (#199)")),
};
