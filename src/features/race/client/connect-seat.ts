import { readResumeKey } from "./resume-key";
import type { connectToRoom } from "./socket";
import type { RoomSocket } from "./socket";
import { bindRaceSocket, type RaceEvent } from "./store";

/**
 * The lobby's `mintRaceToken` action, as the race page receives it (a server action reference passed
 * down by the route: the race feature never imports the lobby, whose client code imports the race).
 */
export type MintRaceToken = (input: {
  code: string;
}) => Promise<
  { ok: true; token: string; url: string } | { ok: false; error: "not-found" | "closed" }
>;

export type ConnectSeatOptions = {
  /** The room code the token is minted for (the lobby's code, `KGB-4821`). */
  code: string;
  /** The room's lobby id: the resume key is read and written under it (#561 C11). */
  lobbyId: string;
  mint: MintRaceToken;
  dispatch: (event: RaceEvent) => void;
  /** The socket module, loaded lazily so socket.io-client stays out of the first load (ADR 0013). */
  load?: () => Promise<{ connectToRoom: typeof connectToRoom }>;
};

/**
 * The seat view's connection (#561 C4, ARCHITECTURE 8.3): mints the race token through the action (ADR
 * 0009: never in a URL, the HTML or a cookie) while the socket chunk downloads, connects with the desk's
 * stored resume key when there is one, and binds the store. Returns the cleanup: a mint still in flight
 * never opens a socket (StrictMode mounts twice in dev); after connecting it unbinds and closes.
 */
export function connectSeat({
  code,
  lobbyId,
  mint,
  dispatch,
  load = () => import("./socket"),
}: ConnectSeatOptions): () => void {
  let aborted = false;
  let socket: RoomSocket | null = null;
  let unbind = () => {};
  Promise.all([mint({ code }), load()]).then(
    ([result, socketModule]) => {
      if (aborted) return;
      if (!result.ok) return dispatch({ type: "token-error", error: result.error });
      socket = socketModule.connectToRoom(result.url, result.token, {
        resumeKey: readResumeKey(lobbyId),
      });
      unbind = bindRaceSocket(socket, dispatch, { lobbyId });
    },
    () => {
      if (!aborted) dispatch({ type: "token-error", error: "generic" });
    },
  );
  return () => {
    aborted = true;
    unbind();
    socket?.close();
  };
}
