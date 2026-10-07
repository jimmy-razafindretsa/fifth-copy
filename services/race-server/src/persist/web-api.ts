import {
  startRaceResponseSchema,
  type StartRaceRequest,
  type StartRaceResponse,
} from "@fifth-copy/protocol";
import type { Clock, Scheduler, TimerHandle } from "../clock";
import { internalHeaders } from "../http/sign";

/**
 * The race server's port to the web app's internal API (ADR 0006 point 6). `createWebApi` is the HMAC
 * HTTP implementation; it rejects on any transport error, non-200 (redirects are not followed),
 * timeout, body over `MAX_WEB_RESPONSE_BYTES` or unparsable body.
 */
export type WebApi = {
  /** `POST /api/internal/races`: creates the Race row and picks the text. Idempotent on `raceId`. */
  startRace(request: StartRaceRequest): Promise<StartRaceResponse>;
};

export const WEB_API_TIMEOUT_MS = 5_000;
/** Same cap as inbound internal bodies: a start answer is a few kB of text and settings. */
export const MAX_WEB_RESPONSE_BYTES = 64 * 1024;

/** Reads at most `max` bytes of a response body, then gives up (the rest is never buffered). */
async function readCapped(response: Response, max: number): Promise<string> {
  const tooLarge = () => new Error(`web api response too large (> ${max} bytes)`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw tooLarge();
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

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
        // A redirect is an answer from the wrong place: never followed, never re-signed elsewhere.
        redirect: "manual",
      });
      status = response.status;
      if (status !== 200) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`web api status ${status}`);
      }
      return parse(JSON.parse(await readCapped(response, MAX_WEB_RESPONSE_BYTES)));
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
