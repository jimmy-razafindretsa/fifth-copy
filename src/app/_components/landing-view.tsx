import { LandingPage, OpenRooms } from "@/features/landing";
import { LobbyEntries, QuickRaceButton, WatchEntry } from "@/features/lobby/client";
import { listOpenLobbies } from "@/features/lobby/server";
import { getT } from "@/i18n";
import { headerGrade } from "./site-header";

/**
 * The landing as composed for `/` (a first-time visitor) and `/welcome` (anyone, #943 C5: a viewer's
 * stable landing URL, where OPEN ROOMS, CREATE PRIVATE RACE, the code join and the guide live).
 * The proxy serves a cookieless `/` from `/welcome` (ADR 0026), so this module is the visitor's whole
 * landing: lobby controls come through the light client door only (`@/features/lobby/client`).
 */
export async function LandingView() {
  const t = await getT();
  const errors = t.landing.errors;
  return (
    <LandingPage
      primary={<QuickRaceButton labels={t.landing.quick} errors={errors} />}
      entries={<LobbyEntries />}
      // the public rooms joinable now (#807); streams in its own Suspense boundary
      // phones watch (#999 C15): at 480px and under the watch entry replaces QUICK RACE and the entries
      watch={<WatchEntry />}
      rooms={<OpenRooms load={() => listOpenLobbies()} labels={t.landing.rooms} errors={errors} />}
      finalAction={<QuickRaceButton variant="inverted" labels={t.landing.quick} errors={errors} />}
      // the header's grade tag (#969)
      grade={headerGrade}
    />
  );
}
