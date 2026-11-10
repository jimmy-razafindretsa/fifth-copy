import type { Member } from "@fifth-copy/protocol";
import { Stamp } from "@/components/ui/stamp";
import { copiedHoldMs } from "./invite-docket";
import { deskLabel, fill, type LobbyLabels } from "./lobby-labels";
import type { NewHostStamp as NewHostState } from "./lobby-store";
import styles from "./lobby.module.css";

/** The NEW HOST stamp holds the UI's slow duration x 5 (#137 C4): 600 ms x 5 = 3 s. */
export const NEW_HOST_HOLD_FACTOR = 5;

/**
 * Under reduced motion `--motion-duration-slow` is `0ms`, but the stamp is news, not motion: it stays
 * the same 3 s it holds at the default tokens (bible 14.3, #137), then goes.
 */
export const NEW_HOST_REDUCED_HOLD_MS = 3_000;

/** How long the NEW HOST stamp stays, in ms, from the computed `--motion-duration-slow` token. */
export function newHostHoldMs(token: string): number {
  return copiedHoldMs(token, NEW_HOST_HOLD_FACTOR) || NEW_HOST_REDUCED_HOLD_MS;
}

/** The new host's name (the stamp prints it upper case), or its desk when the roster lacks it. */
export function newHostName(stamp: NewHostState, members: Member[], labels: LobbyLabels): string {
  return members.find((m) => m.desk === stamp.desk)?.name ?? deskLabel(labels, stamp.desk);
}

/** The roll's one polite sentence for a new host (#137): `Bea is the new host.` */
export const newHostAnnouncement = (stamp: NewHostState, members: Member[], labels: LobbyLabels) =>
  fill(labels.newHost.announce, { name: newHostName(stamp, members, labels) });

/**
 * The host left for good (#137, bible 7.3 and 14.3): the red authority `Stamp` at `md`,
 * `NEW HOST: <NAME>`, slams in over the roll docket at the angle seeded by its event (static under
 * reduced motion), clipped by the docket. Decorative for assistive tech: the roll's polite region says
 * it once (`labels.newHost.announce`). The caller mounts it per `seq` and removes it after the hold.
 */
export function NewHostStampOverlay({
  stamp,
  members,
  labels,
}: {
  stamp: NewHostState;
  members: Member[];
  labels: LobbyLabels;
}) {
  const name = newHostName(stamp, members, labels).toLocaleUpperCase();
  return (
    <div className={styles.newHost} aria-hidden="true" data-new-host={stamp.desk}>
      <Stamp
        key={stamp.seq}
        lines={[fill(labels.newHost.stamp, { name })]}
        tone="red"
        size="md"
        rotation="auto"
        seed={`new-host-${stamp.seq}-${stamp.desk}`}
        role={null}
      />
    </div>
  );
}
