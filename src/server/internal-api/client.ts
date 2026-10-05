import "server-only";
import {
  openRoomResponseSchema,
  type OpenRoomRequest,
  type OpenRoomResponse,
} from "@fifth-copy/protocol";
import { internalHeaders } from "./sign";

export const INTERNAL_TIMEOUT_MS = 2_000;

export type InternalCallResult<T> = { ok: true; data: T } | { ok: false; error: "race-server-unavailable" };

export type InternalApiClient = {
  openRoom(request: OpenRoomRequest): Promise<InternalCallResult<OpenRoomResponse>>;
};

type ClientOptions = {
  baseUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Unix seconds, injected for tests. */
  now?: () => number;
};

// Web -> race server signed internal API (ADR 0006 point 6). Extension point: `patchSettings`
// and `closeRoom` are one method each over the same `post`.
export function createInternalApiClient({
  baseUrl,
  secret,
  fetchImpl = fetch,
  timeoutMs = INTERNAL_TIMEOUT_MS,
  now = () => Math.floor(Date.now() / 1000),
}: ClientOptions): InternalApiClient {
  async function post<T>(
    path: string,
    body: unknown,
    parse: (json: unknown) => T,
  ): Promise<InternalCallResult<T>> {
    // Serialised once: these exact bytes are signed and sent.
    const rawBody = JSON.stringify(body);
    try {
      const response = await fetchImpl(new URL(path, baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...internalHeaders({ rawBody, secret, now: now() }),
        },
        body: rawBody,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 200) return { ok: false, error: "race-server-unavailable" };
      return { ok: true, data: parse(await response.json()) };
    } catch {
      // Refused, timed out, or a 200 whose body is not the declared response.
      return { ok: false, error: "race-server-unavailable" };
    }
  }

  return {
    openRoom: (request) =>
      post("/internal/rooms", request, (json) => openRoomResponseSchema.parse(json)),
  };
}
