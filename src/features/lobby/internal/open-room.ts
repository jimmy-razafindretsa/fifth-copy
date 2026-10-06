import "server-only";
import { PROTOCOL_VERSION, type OpenRoomRequest } from "@fifth-copy/protocol";
import { env } from "@/env";
import { createInternalApiClient } from "@/server/internal-api/client";

// Opens the lobby's waiting room on the race server over the signed internal API (ADR 0006, 0008).
export function openRoom(room: Omit<OpenRoomRequest, "v">) {
  const client = createInternalApiClient({
    baseUrl: env.RACE_SERVER_INTERNAL_URL,
    secret: env.RACE_TOKEN_SECRET,
  });
  return client.openRoom({ v: PROTOCOL_VERSION, ...room });
}
