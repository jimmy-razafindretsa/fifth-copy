import {
  startRaceResponseSchema,
  type StartRaceRequest,
  type StartRaceResponse,
} from "@fifth-copy/protocol";
import type { Clock, Scheduler, TimerHandle } from "../clock";
import { internalHeaders } from "../http/sign";

/**
 * The race server's port to the web app's internal API (ADR 0006 point 6). `createWebApi` is the HMAC
 * HTTP implementation; it rejects on any transport error, non-200, timeout or unparsable body.
 */
export type WebApi = {
  /** `POST /api/internal/races`: creates the Race row and picks the text. Idempotent on `raceId`. */
  startRace(request: StartRaceRequest): Promise<StartRaceResponse>;
};

export const WEB_API_TIMEOUT_MS = 5_000;

type Options = {
  /** The web app's origin (`WEB_ORIGIN`). */
  baseUrl: string;
  /** RACE_TOKEN_SECRET, shared with the web app. */
  secret: string;
  clock: Clock;
  /** Drives the timeout, so the fake scheduler controls it in tests. */
  scheduler: Scheduler;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Signed JSON POSTs to the web app. No retry inside a call: `host:start` is the retry, and the
 * lifecycle bounds it. Logs the path, status and outcome only, never a body or a header.
 */
export function createWebApi({
  baseUrl,
  secret,
  clock,
  scheduler,
  fetchImpl = fetch,
  timeoutMs = WEB_API_TIMEOUT_MS,
}: Options): WebApi {
  async function post<T>(path: string, body: unknown, parse: (json: unknown) => T): Promise<T> {
    // Serialised once: these exact bytes are signed and sent.
    const rawBody = JSON.stringify(body);
    const controller = new AbortController();
    let timer: TimerHandle | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = scheduler.setTimeout(() => {
        controller.abort();
        reject(new Error(`web api timeout after ${timeoutMs} ms`));
      }, timeoutMs);
    });
    let status = 0;
    const call = async () => {
      const response = await fetchImpl(new URL(path, baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...internalHeaders({ rawBody, secret, nowMs: clock.now() }),
        },
        body: rawBody,
        signal: controller.signal,
      });
      status = response.status;
      if (status !== 200) throw new Error(`web api status ${status}`);
      return parse(await response.json());
    };
    try {
      const result = await Promise.race([call(), timedOut]);
      log(path, status, "ok");
      return result;
    } catch (err) {
      log(path, status, "failed");
      throw err;
    } finally {
      if (timer) scheduler.clear(timer);
    }
  }

  return {
    startRace: (request) =>
      post("/api/internal/races", request, (json) => startRaceResponseSchema.parse(json)),
  };
}

function log(path: string, status: number, outcome: "ok" | "failed") {
  console.log(JSON.stringify({ level: "info", msg: "web-api", path, status, outcome }));
}
