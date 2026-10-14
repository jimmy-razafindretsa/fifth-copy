import { notFound } from "next/navigation";
import { mintRaceToken } from "@/features/lobby";
import { getRaceSeat, RaceSeat } from "@/features/race";
import { getT } from "@/i18n";

/**
 * `/race/[raceId]` (#561, ARCHITECTURE 8.1): the seat view of a race (`Race.id`) or of a lobby's room
 * before any start (`Lobby.id`); anything else is a 404. Thin: the seat, the catalog and the lobby's token
 * action go to the race feature's shell. No site header: the race takes the screen (bible 14.3 seat view).
 */
export default async function RacePage({ params }: PageProps<"/race/[raceId]">) {
  const { raceId } = await params;
  const seat = await getRaceSeat(raceId);
  if (!seat) notFound();
  const t = await getT();
  return (
    <main className="flex flex-1 flex-col">
      <RaceSeat seat={seat} labels={t.race} mint={mintRaceToken} />
    </main>
  );
}
