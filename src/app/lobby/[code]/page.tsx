import { LandingHeader } from "@/features/landing";
import { LobbyScreen } from "@/features/lobby";

export default async function LobbyPage({ params }: PageProps<"/lobby/[code]">) {
  const { code } = await params;
  return (
    <>
      <LandingHeader />
      <main className="flex flex-1 flex-col">
        <LobbyScreen code={code} />
      </main>
    </>
  );
}
