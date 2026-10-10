import { fill } from "@/i18n/format";
import { cn } from "@/lib/cn";
import type { SabotageCard, SabotageTrayLabels } from "../view/hud-labels";
import docket from "./hud-docket.module.css";
import styles from "./sabotage-tray.module.css";

export type SabotageTrayProps = {
  /** The catch-up card you hold (spec 10), `null` for none. */
  card: SabotageCard | null;
  /** Seconds left before the next play (ADR 0016 cooldown), 0 when ready. */
  cooldownS: number;
  /** How to play the card (`ENTER TO PLAY`, #236), shown while a card is ready. */
  hint: string | null;
  labels: SabotageTrayLabels;
};

/**
 * The Sabotage tray (#560, design bible 7.4, 7.6, spec 10): a 7.4 docket headed `SABOTAGE TRAY` holding
 * the earned catch-up card as a 7.6 file card (name, effect), its play hint and a cooldown row pulsing
 * with `lkPulse`. Empty, it shows the 7.6 dashed empty slot; while cooling without a card, only the
 * cooldown row. It shows what the server awarded and decides nothing (#236 wires the play, ADR 0007).
 */
export function SabotageTray({ card, cooldownS, hint, labels }: SabotageTrayProps) {
  const seconds = Number.isFinite(cooldownS) ? Math.max(0, Math.ceil(cooldownS)) : 0;
  const cooling = seconds > 0;
  const info = card ? labels.cards[card] : null;
  return (
    <section
      aria-label={labels.title}
      data-sabotage-tray
      data-card={card ?? "none"}
      data-cooling={cooling || undefined}
      className={cn(docket.docket, styles.tray)}
    >
      <div className={docket.head}>
        <span className={docket.tag}>{labels.title}</span>
      </div>
      {info ? (
        <div data-slot className={styles.slot}>
          <p className={styles.name}>{info.name}</p>
          <p className={styles.effect}>{info.effect}</p>
        </div>
      ) : null}
      {!info && !cooling ? (
        <div data-empty className={styles.empty}>
          <p className={styles.emptyTitle}>{labels.empty.title}</p>
          <p className={styles.effect}>{labels.empty.body}</p>
        </div>
      ) : null}
      {info && !cooling && hint ? (
        <dl className={styles.rows}>
          <div data-row="play" className={docket.row}>
            <dt className={docket.label}>{labels.play}</dt>
            <dd className={cn(docket.value, styles.hint)}>{hint}</dd>
          </div>
        </dl>
      ) : null}
      {cooling ? (
        <dl className={styles.rows}>
          <div data-row="cooldown" className={cn(docket.row, docket.pulse)}>
            <dt className={docket.label}>{labels.cooldown}</dt>
            <dd className={docket.value}>{fill(labels.seconds, { n: seconds })}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
