import type { CSSProperties } from "react";
import type { Member } from "@fifth-copy/protocol";
import { rivalIdentity } from "@/lib/rival-identity";
import { fill, type LobbyLabels } from "./lobby-labels";
import styles from "./seat-ring.module.css";

type RingMember = Pick<Member, "desk" | "name" | "isHost" | "isBot" | "color" | "marker">;

/** Initials of the first two words of a name (letters only, upper case); a name with no letter keeps its first character. */
export function initialsOf(name: string): string {
  const words = name.match(/\p{L}+/gu) ?? [];
  if (words.length === 0) return name.trim().slice(0, 1).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * The seat ring diagram (#731, bible 1 and 14.3): the room's `seats` desks in a ring around the Major,
 * drawn from the roster only (`members`, `you`), so the projector view (#285) can render it from a
 * spectator's roster (`you` = null). Pure CSS (ADR 0013: no WebGL in the lobby): desk `i` sits at
 * `rotate(i x 360/seats deg) translateY(-r)` and turns back so its text stays upright; `r` comes from the
 * ring's width (container units), so it fits its slot. One `role="img"` named with the count; the cells
 * are decoration for assistive tech (the roll lists the same people).
 */
export function SeatRing({
  members,
  you,
  seats,
  labels,
}: {
  members: readonly RingMember[];
  you: number | null;
  seats: number;
  labels: LobbyLabels["ring"];
}) {
  const byDesk = new Map(members.map((m) => [m.desk, m]));
  const taken = members.filter((m) => m.desk >= 1 && m.desk <= seats).length;
  const step = 360 / seats;
  return (
    <div
      role="img"
      aria-label={fill(labels.name, { n: taken, max: seats })}
      className={styles.ring}
      data-seat-ring
    >
      <span className={styles.major} aria-hidden="true">
        {labels.major}
      </span>
      {Array.from({ length: seats }, (_, i) => {
        const desk = i + 1;
        const m = byDesk.get(desk);
        const a = i * step;
        const style: CSSProperties = {
          transform: `rotate(${a}deg) translateY(calc(-1 * var(--ring-r))) rotate(${-a}deg)`,
        };
        const number = String(desk).padStart(2, "0");
        if (!m)
          return (
            <span
              key={desk}
              aria-hidden="true"
              className={styles.cell}
              data-desk={desk}
              data-state="empty"
              style={style}
            >
              <span className={styles.face}>
                <span className={styles.top}>
                  <span className={styles.num}>{number}</span>
                </span>
              </span>
            </span>
          );
        const ink = rivalIdentity(m, you).colour;
        return (
          <span
            key={desk}
            aria-hidden="true"
            className={styles.cell}
            data-desk={desk}
            data-state={ink === "you" ? "you" : "taken"}
            data-ink={ink}
            data-bot={m.isBot ? "true" : undefined}
            style={style}
          >
            <span className={styles.face}>
              <span className={styles.top}>
                <span className={styles.num}>{number}</span>
                {m.isHost && !m.isBot ? <span className={styles.dot} /> : null}
                {m.isBot ? <span className={styles.bot}>{labels.bot}</span> : null}
              </span>
              <span className={styles.initials}>{initialsOf(m.name)}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}
