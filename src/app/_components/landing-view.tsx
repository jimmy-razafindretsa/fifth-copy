import { LandingPage, OpenRooms } from "@/features/landing";
import { LobbyEntries, QuickRaceButton } from "@/features/lobby";
import { listOpenLobbies } from "@/features/lobby/server";
import { getT } from "@/i18n";

/**
 * The landing as composed for `/` (a first-time visitor) and `/welcome` (anyone, #943 C5: a viewer's
 * stable landing URL, where OPEN ROOMS, CREATE PRIVATE RACE, the code join and the guide live).
 */
export async function LandingView() {
  const t = await getT();
  const errors = t.landing.errors;
  return (
    <LandingPage
      primary={<QuickRaceButton labels={t.landing.quick} errors={errors} />}
      entries={<LobbyEntries />}
      // the public rooms joinable now (#807); streams in its own Suspense boundary
      rooms={<OpenRooms load={() => listOpenLobbies()} labels={t.landing.rooms} errors={errors} />}
      finalAction={<QuickRaceButton variant="inverted" labels={t.landing.quick} errors={errors} />}
    />
  );
}
