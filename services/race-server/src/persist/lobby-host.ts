import {
  PROTOCOL_VERSION,
  setLobbyHostRequestSchema,
  type SetLobbyHostRequest,
} from "@fifth-copy/protocol";
import { WebApiStatusError, type WebApi } from "./web-api";

/**
 * The race -> web host transfer record (#137, ADR 0006 point 6, ADR 0008): the room hash's
 * `hostUserId` is the live truth; `Lobby.hostUserId` is the durable copy the web's host-only actions
 * read (`setLobbyType`, `createInvite`). The call rides the results outbox (`persist/outbox.ts`), so a
 * web outage never blocks the promotion; one id per lobby keeps successive transfers in order.
 */

/** The outbox id of a lobby's host transfers; race ids are uuids and closes `lobby:`, so none collide. */
export const lobbyHostOutboxId = (lobbyId: string) => `host:${lobbyId}`;

export const setLobbyHostRequest = (lobbyId: string, hostUserId: string): SetLobbyHostRequest => ({
  v: PROTOCOL_VERSION,
  lobbyId,
  hostUserId,
});

/**
 * The outbox's `send` for a host transfer: acknowledged by a 200 for the same lobby, and by a 404 (no
 * such lobby or user: retrying would never succeed). Anything else is retried.
 */
export const sendLobbyHost =
  (webApi: Pick<WebApi, "setLobbyHost">) =>
  async (entry: unknown): Promise<boolean> => {
    const request = setLobbyHostRequestSchema.parse(entry);
    try {
      const answer = await webApi.setLobbyHost(request);
      return answer.lobbyId === request.lobbyId;
    } catch (err) {
      if (err instanceof WebApiStatusError && err.status === 404) return true;
      throw err;
    }
  };
