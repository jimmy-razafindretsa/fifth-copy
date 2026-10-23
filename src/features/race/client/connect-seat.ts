import { releaseParkedSocket } from "./handoff";
import { readResumeKey } from "./resume-key";
import type { connectToRoom } from "./socket";
import type { Off, RoomSocket } from "./socket";
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
  /** Gets the socket once it is open (the typing path of #559 sends through it); its `Off` runs at cleanup. */
  onSocket?: (socket: RoomSocket) => Off;
};

/**
 * The seat view's connection (#561 C4, ARCHITECTURE 8.3): mints the race token through the action (ADR
 * 0009: never in a URL, the HTML or a cookie) while the socket chunk downloads, connects with the desk's
 * stored resume key when there is one, and binds the store. Its first `welcome` closes the waiting
 * room's socket parked for this lobby (#214 C2: the desk is never line-cut in the handover). Returns the
 * cleanup: a mint still in flight never opens a socket (StrictMode mounts twice in dev); after
 * connecting it unbinds and closes (a parked socket is left to the next mount or its own timeout).
 */
export function connectSeat({
  code,
  lobbyId,
  mint,
  dispatch,
  load = () => import("./socket"),
  onSocket,
}: ConnectSeatOptions): () => void {
  let aborted = false;
  let socket: RoomSocket | null = null;
  let unbind = () => {};
  Promise.all([mint({ code }), load()]).then(
    ([result, socketModule]) => {
      if (aborted) return;
      if (!result.ok) return dispatch({ type: "token-error", error: result.error });
      socket = socketModule.connectToRoom(result.url, result.token, {
        resumeKey: () => readResumeKey(lobbyId),
      });
      const offBind = bindRaceSocket(socket, dispatch, { lobbyId });
      const offHandoff = socket.onWelcome(() => releaseParkedSocket(lobbyId));
      const offSocket = onSocket?.(socket) ?? (() => {});
      unbind = () => {
        offSocket();
        offBind();
        offHandoff();
      };
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
