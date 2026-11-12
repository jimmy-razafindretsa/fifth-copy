import {
  closeLobbyRequestSchema,
  PROTOCOL_VERSION,
  setLobbyHostRequestSchema,
  type CloseLobbyRequest,
} from "@fifth-copy/protocol";
import { sendLobbyHost } from "./lobby-host";
import { sendResults } from "./results";
import { WebApiStatusError, type WebApi } from "./web-api";

/**
 * The race -> web lobby close (#734, ADR 0008): when the last human leaves a waiting room (or a room
 * is found gone on boot, #204) the `Lobby` row must become CLOSED. The call rides the results outbox
 * (`persist/outbox.ts`), so a web outage never blocks the leave and a restart resumes it.
 */

/** The outbox id of a lobby's close call; race ids are uuids, so the two never collide. */
export const lobbyCloseOutboxId = (lobbyId: string) => `lobby:${lobbyId}`;

export const closeLobbyRequest = (lobbyId: string, closedAt: number): CloseLobbyRequest => ({
  v: PROTOCOL_VERSION,
  lobbyId,
  closedAt,
});

/**
 * The outbox's `send` for a close: acknowledged by a 200 for the same lobby, and by a 404 (no such
 * lobby: nothing left to close, retrying would never succeed). Anything else is retried.
 */
export const sendLobbyClose =
  (webApi: Pick<WebApi, "closeLobby">) =>
  async (entry: unknown): Promise<boolean> => {
    const request = closeLobbyRequestSchema.parse(entry);
    try {
      const answer = await webApi.closeLobby(request);
      return answer.lobbyId === request.lobbyId;
    } catch (err) {
      if (err instanceof WebApiStatusError && err.status === 404) return true;
      throw err;
    }
  };

/**
 * The one `send` of the race server's outbox: a close entry goes to `sendLobbyClose`, a host transfer
 * (#137) to `sendLobbyHost`, the rest are results.
 */
export const sendOutboxEntry = (
  webApi: Pick<WebApi, "closeLobby" | "postResults" | "setLobbyHost">,
) => {
  const close = sendLobbyClose(webApi);
  const host = sendLobbyHost(webApi);
  const results = sendResults(webApi);
  return (entry: unknown): Promise<boolean> => {
    if (closeLobbyRequestSchema.safeParse(entry).success) return close(entry);
    if (setLobbyHostRequestSchema.safeParse(entry).success) return host(entry);
    return results(entry);
  };
};
