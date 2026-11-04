import { notFound } from "next/navigation";
import { roomCodeSchema } from "@fifth-copy/protocol";
import {
  canIssueResetIn,
  getViewer,
  issuePasswordReset,
  RESET_CODE_TTL_MS,
} from "@/features/identity";
import { getT } from "@/i18n";
import { findLobbyByCode } from "../queries/get-lobby-by-code";
import { LobbyLive } from "./lobby-live";
import { ResetDocket } from "./reset-docket";
import styles from "./lobby.module.css";

/**
 * `/lobby/[code]` (ARCHITECTURE 8.1, 8.3): the shell renders on the server, the roll connects in
 * the client leaf. Only a canonical code (`KGB-4821`) of an existing lobby renders; anything else is
 * `notFound()`. A closed lobby still renders: its token request answers `closed` as an error line. The
 * kicker names the room's type from the row (`Lobby.type`, #105), and so does the docket's LOBBY row
 * (#114): `setLobbyType` revalidates this page, so both follow the host's change. The host's
 * `PASSWORD RESET` docket (#790) renders only for the lobby's host, signed in as an account flagged a
 * teacher (#788, owner decision 2026-11-04): decided here, never hidden in the client; the action
 * re-checks all of it (ADR 0009).
 */
export async function LobbyScreen({ code }: { code: string }) {
  const parsed = roomCodeSchema.safeParse(code);
  if (!parsed.success) notFound();
  const lobby = await findLobbyByCode(parsed.data);
  if (!lobby) notFound();

  const t = await getT();
  const viewer = await getViewer();
  const canReset =
    viewer !== null &&
    !viewer.isGuest &&
    lobby.hostUserId === viewer.id &&
    (await canIssueResetIn(lobby.code, viewer.id));
  return (
    <section className={styles.screen} aria-labelledby="lobby-heading">
      <div className={styles.kicker}>
        {lobby.type === "PUBLIC" ? t.lobby.kicker.public : t.lobby.kicker.private}
      </div>
      <h1 id="lobby-heading" className={styles.heading}>
        {t.lobby.heading}
      </h1>
      <LobbyLive
        code={lobby.code}
        lobbyId={lobby.id}
        lobbyType={lobby.type === "PUBLIC" ? "public" : "private"}
        labels={t.lobby}
        errors={t.landing.errors}
        reset={
          canReset ? (
            <ResetDocket
              // a server element in the client view's column: keyed, as React asks of a passed child
              key="reset"
              code={lobby.code}
              issue={issuePasswordReset}
              labels={t.lobby.reset}
              prefix={t.landing.errors.prefix}
              ttlMinutes={RESET_CODE_TTL_MS / 60_000}
            />
          ) : null
        }
      />
    </section>
  );
}
