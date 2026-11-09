import { LandingPage, OpenRooms } from "@/features/landing";
import { LobbyEntries, QuickRaceButton } from "@/features/lobby";
import { listOpenLobbies } from "@/features/lobby/server";
import { getT } from "@/i18n";

export default async function Home() {
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
