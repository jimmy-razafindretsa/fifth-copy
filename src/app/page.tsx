import { LandingHeader, LandingHero } from "@/features/landing";
import { LobbyEntries } from "@/features/lobby";

export default function Home() {
  return (
    <>
      <LandingHeader />
      <main className="flex flex-1 flex-col">
        <LandingHero actions={<LobbyEntries />} />
      </main>
    </>
  );
}
