import { FirstRaceLayoutPrompt } from "@/features/identity";
import { LandingHeader } from "@/features/landing";
import { LobbyScreen } from "@/features/lobby";

export default async function LobbyPage({ params }: PageProps<"/lobby/[code]">) {
  const { code } = await params;
  return (
    <>
      {/* asks once for the keyboard layout before the first race (#70); first in the DOM, so once it
          closes the keyboard resumes at the top of the page */}
      <FirstRaceLayoutPrompt />
      <LandingHeader />
      <main className="flex flex-1 flex-col">
        <LobbyScreen code={code} />
      </main>
    </>
  );
}
