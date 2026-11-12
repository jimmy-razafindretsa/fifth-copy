import type { Member } from "@fifth-copy/protocol";
import type { HostKickResult } from "@/features/race";
import { cn } from "@/lib/cn";
import { copiedHoldMs } from "./invite-docket";
import { fill, type LobbyLabels } from "./lobby-labels";
import styles from "./lobby.module.css";

type RemoveLabels = LobbyLabels["remove"];

/** A refused `host:kick` (or no answer): the roll's 7.4 error line reads its sentence. */
export type RemoveError = Extract<HostKickResult, { ok: false }>["error"];

/**
 * The host's removal of a typist (#133): the desk whose REMOVE reads CONFIRM (`confirm`), the desk whose
 * `host:kick` is on its way (`pending`), the last refusal (`error`).
 */
export type RemoveState = {
  confirm: number | null;
  pending: number | null;
  error: RemoveError | null;
};

export const IDLE_REMOVE: RemoveState = { confirm: null, pending: null, error: null };

/** CONFIRM holds for five of the UI's slow duration (bible 14.3, #133): the COPIED hold recipe. */
export const CONFIRM_HOLD_FACTOR = 5;

/**
 * How long CONFIRM holds, in ms, from the computed `--motion-duration-slow` token: 600ms x 5. Under
 * reduced motion the token is `0ms`, so the hold is 0 and CONFIRM stays until the button blurs.
 */
export const confirmHoldMs = (token: string) => copiedHoldMs(token, CONFIRM_HOLD_FACTOR);

/** Whether the viewer may remove this row: the host, on a human row that is neither theirs nor a host. */
export function canRemove(member: Member, you: number | null, viewerHosts: boolean): boolean {
  return viewerHosts && !member.isBot && !member.isHost && member.desk !== you;
}

/**
 * The row-sized 7.1 secondary `REMOVE` (bible 14.3, the bot row's recipe) on a typist's roll row, for
 * the host. The first press turns it into the ink `CONFIRM` in place (no dialog, no focus move); the
 * second sends the removal. Named `REMOVE <name>` (`CONFIRM · REMOVE <name>` while it holds); while the
 * removal is on its way it keeps CONFIRM, `aria-disabled`, so the focus stays.
 */
export function RemoveButton({
  member,
  state,
  labels,
  onPress,
  onBlur,
}: {
  member: Member;
  state: RemoveState;
  labels: RemoveLabels;
  onPress?: (desk: number) => void;
  onBlur?: (desk: number) => void;
}) {
  const pending = state.pending === member.desk;
  const confirming = pending || state.confirm === member.desk;
  return (
    <button
      type="button"
      className={cn(styles.secondary, styles.remove)}
      data-confirm={confirming ? "" : undefined}
      aria-label={fill(confirming ? labels.confirmName : labels.name, { name: member.name })}
      aria-disabled={pending || undefined}
      onClick={() => {
        if (!pending) onPress?.(member.desk);
      }}
      onBlur={() => onBlur?.(member.desk)}
    >
      {confirming ? labels.confirm : labels.button}
    </button>
  );
}
