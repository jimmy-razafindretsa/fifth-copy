import { notFound } from "next/navigation";
import { roomCodeSchema } from "@fifth-copy/protocol";
import { getT } from "@/i18n";
import { findLobbyByCode } from "../queries/get-lobby-by-code";
import { LobbyLive } from "./lobby-live";
import styles from "./lobby.module.css";

/**
 * `/lobby/[code]` (ARCHITECTURE 8.1, 8.3): the shell renders on the server, the roll connects in
 * the client leaf. Only a canonical code (`KGB-4821`) of an existing lobby renders; anything else is
 * `notFound()`. A closed lobby still renders: its token request answers `closed` as an error line.
 */
export async function LobbyScreen({ code }: { code: string }) {
  const parsed = roomCodeSchema.safeParse(code);
  if (!parsed.success) notFound();
  const lobby = await findLobbyByCode(parsed.data);
  if (!lobby) notFound();

  const t = await getT();
  return (
    <section className={styles.screen} aria-labelledby="lobby-heading">
      <div className={styles.kicker}>{t.lobby.kicker}</div>
      <h1 id="lobby-heading" className={styles.heading}>
        {t.lobby.heading}
      </h1>
      <LobbyLive code={lobby.code} labels={t.lobby} errors={t.landing.errors} />
    </section>
  );
}
