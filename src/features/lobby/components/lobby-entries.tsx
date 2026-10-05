import { getT } from "@/i18n";
import { CreateLobbyButton } from "./create-lobby-button";
import { JoinByCodeForm } from "./join-by-code-form";

/** The landing's private-lobby entries (hero `actions` slot): create, then join with a code. */
export async function LobbyEntries() {
  const t = await getT();
  return (
    <>
      <CreateLobbyButton labels={t.landing.actions} errors={t.landing.errors} />
      <JoinByCodeForm labels={t.landing.actions} errors={t.landing.errors} />
    </>
  );
}
