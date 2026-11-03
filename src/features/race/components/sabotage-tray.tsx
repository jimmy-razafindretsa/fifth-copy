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
  /** The server refused your play (#236): the `IMMUNE` row shows and shakes once. */
  refused?: boolean;
  /**
   * Plays the ready card (#236): the pointer path beside Enter, as the `PLAY CARD` ink button. Absent
   * (the server render, the specimens): no button.
   */
  onPlay?: () => void;
};

/**
 * The Sabotage tray (#560, design bible 7.4, 7.6, spec 10): a 7.4 docket headed `SABOTAGE TRAY` holding
 * the earned catch-up card as a 7.6 file card (name, effect), its play hint and a cooldown row whose seconds
 * pulse with `lkPulse`. Empty, it shows the 7.6 dashed empty slot; while cooling without a card, only the
 * cooldown row. It shows what the server awarded and decides nothing (ADR 0007). #236: a refused play
 * shows the `IMMUNE` row under the header (a polite `status`, the 7.4 notice row on the urgent ground,
 * shaking once with `lkShake`, still under reduced motion), and a ready card gets the `PLAY CARD` ink
 * button, which never takes the focus from the race input (a mouse press keeps it there).
 */
export function SabotageTray({
  card,
  cooldownS,
  hint,
  labels,
  refused = false,
  onPlay,
}: SabotageTrayProps) {
  const seconds = Number.isFinite(cooldownS) ? Math.max(0, Math.ceil(cooldownS)) : 0;
  const cooling = seconds > 0;
  const info = card ? labels.cards[card] : null;
  const ready = info !== null && !cooling;
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
      {/* always present, so the refusal is announced when it lands */}
      <div role="status" aria-atomic="true" data-refusal>
        {refused ? (
          <p data-row="refused" className={cn(docket.notice, styles.refused)}>
            {labels.immune}
          </p>
        ) : null}
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
      {ready && hint ? (
        <dl className={styles.rows}>
          <div data-row="play" className={docket.row}>
            <dt className={docket.label}>{labels.play}</dt>
            <dd className={cn(docket.value, styles.hint)}>{hint}</dd>
          </div>
        </dl>
      ) : null}
      {ready && onPlay ? (
        <div className={styles.actions}>
          <button
            type="button"
            data-play
            className={cn(docket.ink, styles.play)}
            // the race input keeps the focus: a click plays, the next key still types
            onMouseDown={(e) => e.preventDefault()}
            onClick={onPlay}
          >
            {labels.playButton}
          </button>
        </div>
      ) : null}
      {cooling ? (
        <dl className={styles.rows}>
          <div data-row="cooldown" className={docket.row}>
            <dt className={docket.label}>{labels.cooldown}</dt>
            <dd className={cn(docket.value, docket.pulse)}>
              {fill(labels.seconds, { n: seconds })}
            </dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
