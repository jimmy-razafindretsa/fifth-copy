import { getT } from "@/i18n";
import { CreateLobbyButton } from "./create-lobby-button";
import { JoinByCodeForm } from "./join-by-code-form";
import { PracticeButton } from "./practice-button";
import { WatchEntryForm } from "./watch-entry-form";

/** The landing's private-lobby entries (hero `actions` slot): create, practise against bots (#367), then join with a code. */
export async function LobbyEntries() {
  const t = await getT();
  return (
    <>
      <CreateLobbyButton labels={t.landing.actions} errors={t.landing.errors} />
      <PracticeButton labels={t.landing.entries} errors={t.landing.errors} />
      <JoinByCodeForm labels={t.landing.actions} errors={t.landing.errors} />
    </>
  );
}

/** #999 C15: the phone landing's watch entry (hero `watch` slot): a room code or a spectator link. */
export async function WatchEntry() {
  const t = await getT();
  return <WatchEntryForm labels={t.landing.watch} errors={t.landing.errors} />;
}
