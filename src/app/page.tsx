import { LandingPage } from "@/features/landing";
import { LobbyEntries, QuickRaceButton } from "@/features/lobby";
import { getT } from "@/i18n";

export default async function Home() {
  const t = await getT();
  const errors = t.landing.errors;
  return (
    <LandingPage
      primary={<QuickRaceButton labels={t.landing.quick} errors={errors} />}
      entries={<LobbyEntries />}
      finalAction={<QuickRaceButton variant="inverted" labels={t.landing.quick} errors={errors} />}
    />
  );
}
