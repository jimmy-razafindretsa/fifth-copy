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
 * The seat ring diagram (#731, bible 1 and 14.3; #951): the taken desks only, evenly spaced in a ring
 * around the Major (the 3D room's rule, #927), drawn from the roster only (`members`, `you`), so the
 * projector view (#285) can render it from a spectator's roster (`you` = null). Pure CSS (ADR 0013): the
 * `i`th taken desk sits at `rotate(i x 360/n deg) translateY(-r)` and turns back so its text stays
 * upright; few desks draw bigger; `r` comes from the
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
  // #951 (like the 3D room of #927): only the taken desks, evenly spaced around the Major
  const seated = members
    .filter((m) => m.desk >= 1 && m.desk <= seats)
    .toSorted((x, y) => x.desk - y.desk);
  const taken = seated.length;
  const step = 360 / Math.max(1, taken);
  return (
    <div
      role="img"
      aria-label={fill(labels.name, { n: taken, max: seats })}
      className={styles.ring}
      data-seat-ring
      data-count={taken <= 8 ? "few" : taken <= 16 ? "some" : "many"}
    >
      <span className={styles.major} aria-hidden="true">
        {labels.major}
      </span>
      {seated.map((m, i) => {
        const desk = m.desk;
        const a = i * step;
        const style: CSSProperties = {
          transform: `rotate(${a}deg) translateY(calc(-1 * var(--ring-r))) rotate(${-a}deg)`,
        };
        const number = String(desk).padStart(2, "0");
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
