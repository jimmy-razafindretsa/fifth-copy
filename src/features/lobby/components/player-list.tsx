import type { ReactNode } from "react";
import type { Member } from "@fifth-copy/protocol";
import { deskLabel, type LobbyLabels } from "./lobby-labels";
import styles from "./lobby.module.css";

type Slot = (member: Member) => ReactNode;

/**
 * The roll of the waiting room: one bible 7.4 docket row per member (`DESK 05 | name`), with the
 * crooked `HOST` stamp (7.3) and the ink `YOU` tag. Slots: `leading` (avatar, card 490) before the name,
 * `tags` (BOT docket card 490, stamps card 139) after the badges. Scrolls inside its docket, so it is a
 * focusable, named region for keyboard users.
 */
export function PlayerList({
  members,
  you,
  labels,
  leading,
  tags,
}: {
  members: Member[];
  you: number | null;
  labels: LobbyLabels;
  leading?: Slot;
  tags?: Slot;
}) {
  return (
    // the list scrolls, so it takes focus (axe scrollable-region-focusable)
    <ul className={styles.list} aria-label={labels.listName} tabIndex={0}>
      {members.map((member) => (
        <li key={member.desk} className={styles.row}>
          <span className={styles.label}>{deskLabel(labels, member.desk)}</span>
          <span className={styles.who}>
            {leading?.(member)}
            <span className={styles.name}>{member.name}</span>
            {member.isHost ? <span className={styles.stamp}>{labels.host}</span> : null}
            {member.desk === you ? <span className={styles.tag}>{labels.you}</span> : null}
            {tags?.(member)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Loading state: newsprint blocks in the row grid, `aria-busy` until `welcome`. */
export function PlayerListSkeleton({ labels, rows = 3 }: { labels: LobbyLabels; rows?: number }) {
  return (
    <>
      <ul className={styles.list} aria-label={labels.listName} aria-busy="true">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className={styles.row} aria-hidden="true">
            <span className={styles.block} />
            <span className={`${styles.block} ${styles.blockName}`} />
          </li>
        ))}
      </ul>
      <p className={styles.srOnly}>{labels.loading}</p>
    </>
  );
}
