import { notFound } from "next/navigation";
import { mintRaceToken } from "@/features/lobby";
import { getRaceSeat, machineRows, RaceSeat } from "@/features/race";
import { getLocale, getT } from "@/i18n";
import { SeatScene } from "./seat-scene";

/**
 * `/race/[raceId]` (#561, ARCHITECTURE 8.1): the seat view of a race (`Race.id`) or of a lobby's room
 * before any start (`Lobby.id`); anything else is a 404. Thin: the seat, the catalog, the machine's keys
 * and the lobby's token action go to the race feature's shell. No site header: the race takes the screen
 * (bible 14.3 seat view). The keys follow the viewer's keyboard layout (#224, R179): none is saved yet, so
 * the UI language picks it; the settings screen (#66) passes the saved layout in place of `null`.
 * The 3D seat scene (#563) is `SeatScene`, a client leaf that loads race-3d after the HUD mounted.
 */
export default async function RacePage({ params }: PageProps<"/race/[raceId]">) {
  const { raceId } = await params;
  const seat = await getRaceSeat(raceId);
  if (!seat) notFound();
  const t = await getT();
  const rows = await machineRows({ layout: null, locale: await getLocale() });
  return (
    <main className="flex flex-1 flex-col">
      <RaceSeat
        seat={seat}
        labels={t.race}
        mint={mintRaceToken}
        rows={rows}
        scene={<SeatScene labels={t.race.scene} notice={t.race.notice} tips={t.race.didYouKnow} />}
      />
    </main>
  );
}
