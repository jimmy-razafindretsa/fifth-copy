import { InviteRefused, mintSpectatorToken } from "@/features/lobby";
import { peekSpectatorLink } from "@/features/lobby/server";
import { PhoneScreen, PhoneSwitch, ProjectorScreen } from "@/features/race";
import { getT } from "@/i18n";
import { SiteHeader } from "@/app/_components/site-header";
import { ProjectorStage } from "../../race/[raceId]/projector-stage";
import { WatchRing } from "../../race/[raceId]/watch-ring";

/**
 * `/watch/[token]` (#999 C12, C13; bible 14.3 "Projector view", ARCHITECTURE 8.1): a reusable spectator
 * link. The page reads the link (never consumes it) and opens the projector view of its room on the
 * spectator channel; the token is minted by `mintSpectatorToken` bound to the link's token (already
 * this page's URL), with a guest created on demand (ADR 0009). The page never holds the room code:
 * the projector gets `code: null`, and no payload, action result or token here carries it. A link
 * that is unknown, expired or whose room is gone shows the invite's refusal screen (same words: ask
 * the host for a new link, or join with the code); Redis away or a spent budget its inline error line.
 */
export default async function Watch({ params }: PageProps<"/watch/[token]">) {
  const { token } = await params;
  const [t, link] = await Promise.all([getT(), peekSpectatorLink(token)]);
  if (!link.ok) {
    return (
      <>
        <SiteHeader />
        <main className="flex flex-1 flex-col">
          <InviteRefused
            outcome={link.error}
            labels={t.invite}
            errors={t.landing.errors}
            entry={t.landing.actions}
          />
        </main>
      </>
    );
  }
  const seat = { lobbyId: link.lobbyId, code: null };
  const mint = mintSpectatorToken.bind(null, token);
  // #999 C9, C10: a phone gets the phone spectator screen instead (decided at mount)
  return (
    <main className="flex flex-1 flex-col">
      <PhoneSwitch
        phone={
          <PhoneScreen
            seat={seat}
            labels={t.race}
            mint={mint}
            ring={<WatchRing labels={t.lobby.ring} />}
          />
        }
        wide={
          <ProjectorScreen
            seat={seat}
            labels={t.race}
            mint={mint}
            stage={<ProjectorStage labels={t.lobby.ring} title={t.race.projector.scene} />}
          />
        }
      />
    </main>
  );
}
