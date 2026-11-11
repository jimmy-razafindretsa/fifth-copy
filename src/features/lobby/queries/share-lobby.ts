import "server-only";
import { PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { env } from "@/env";
import { racedTogether } from "@/features/results";
import { createInternalApiClient, type InternalApiClient } from "@/server/internal-api/client";

type Options = {
  /** Injected in tests; defaults to the signed client of the app env. */
  client?: InternalApiClient;
  /** Ms epoch, injected in tests. */
  now?: () => number;
};

/** Path (a): the race server says both are members of one live room. Any failure is false. */
async function liveRoom(viewerId: string, ownerId: string, client?: InternalApiClient) {
  try {
    const raceServer =
      client ??
      createInternalApiClient({
        baseUrl: env.RACE_SERVER_INTERNAL_URL,
        secret: env.RACE_TOKEN_SECRET,
      });
    const answer = await raceServer.sharedRoom({
      v: PROTOCOL_VERSION,
      userIds: [viewerId, ownerId],
    });
    return answer.ok && answer.data.shared === true;
  } catch {
    return false;
  }
}

/** Path (b): both raced in one race that ended less than 24 h ago. A Postgres error is false. */
async function recentRace(viewerId: string, ownerId: string, now: number) {
  try {
    return await racedTogether(viewerId, ownerId, now);
  } catch {
    return false;
  }
}

/**
 * The one lobby-scoped access rule (ADR 0022, #880): whether `viewerId` shares a lobby with
 * `ownerId`, i.e. (a) the race server answers that both are members of one live room (any phase;
 * spectators and bots are not members), or (b) both have a `RaceResult` on one `Race` that ended less
 * than 24 h before `now`. Fails closed and never throws: no answer from the race server leaves path
 * (b) to decide; a Postgres error is false. One race server lookup per call, never cached. The same
 * id twice is false (the owner's own access is the caller's rule). The only caller of `sharedRoom`.
 */
export async function shareLobby(
  viewerId: string,
  ownerId: string,
  { client, now = Date.now }: Options = {},
): Promise<boolean> {
  if (viewerId === ownerId) return false;
  // Both paths run on every call, so a refusal takes the same work whichever path failed.
  const [live, recent] = await Promise.all([
    liveRoom(viewerId, ownerId, client),
    recentRace(viewerId, ownerId, now()),
  ]);
  return live || recent;
}
