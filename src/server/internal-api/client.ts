import "server-only";
import {
  openRoomResponseSchema,
  roomStatusResponseSchema,
  roomTypeResponseSchema,
  sharedRoomResponseSchema,
  type OpenRoomRequest,
  type OpenRoomResponse,
  type RoomStatusRequest,
  type RoomStatusResponse,
  type RoomTypeRequest,
  type RoomTypeResponse,
  type SharedRoomRequest,
  type SharedRoomResponse,
} from "@fifth-copy/protocol";
import { internalHeaders } from "./sign";

export const INTERNAL_TIMEOUT_MS = 2_000;

export type InternalCallResult<T> =
  { ok: true; data: T } | { ok: false; error: "race-server-unavailable" };

export type InternalApiClient = {
  openRoom(request: OpenRoomRequest): Promise<InternalCallResult<OpenRoomResponse>>;
  /** Which of these lobbies have a live room, its phase and desk counts (#806). Read only. */
  roomStatus(request: RoomStatusRequest): Promise<InternalCallResult<RoomStatusResponse>>;
  /**
   * The host filed PUBLIC or PRIVATE (#815): the room's answer (`ok`, `no-room`, `not-waiting`) before
   * the web writes `Lobby.type`.
   */
  setRoomType(request: RoomTypeRequest): Promise<InternalCallResult<RoomTypeResponse>>;
  /**
   * Whether two users are members of the same live room (#65, ADR 0022). Read only. Fails closed:
   * anything but a parsed 200 is `race-server-unavailable`, which callers treat as not shared.
   */
  sharedRoom(request: SharedRoomRequest): Promise<InternalCallResult<SharedRoomResponse>>;
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
    roomStatus: (request) =>
      post("/internal/rooms/status", request, (json) => roomStatusResponseSchema.parse(json)),
    setRoomType: (request) =>
      post("/internal/rooms/type", request, (json) => roomTypeResponseSchema.parse(json)),
    sharedRoom: (request) =>
      post("/internal/rooms/shared", request, (json) => sharedRoomResponseSchema.parse(json)),
  };
}
