import { Stamp } from "@/components/ui";
import docket from "./hud-docket.module.css";
import styles from "./loading-card.module.css";

/** The `race.scene` copy (#563, bible 7.4 extension): the stamp, the frame's name, the tip's tag. */
export type SceneLabels = {
  /** `LOADING THE RING ROOM` / `CHARGEMENT DE LA SALLE`. */
  loading: string;
  /** The scene frame's name (decorative, for the record). */
  title: string;
  /** `DID YOU KNOW?` / `LE SAVAIS-TU ?`, the tag of the optional tip row. */
  didYouKnow: string;
};

export type LoadingCardProps = {
  labels: SceneLabels;
  /** One line of `race.didYouKnow` (#383 fills the list); `null` hides the row. */
  tip: string | null;
};

/**
 * The scene's loading card (#563 C2, bible 7.3, 7.4 extension): a one-docket card in the free area above
 * the typing surface (never over the telex strip or the sheet), the ink `Stamp` `LOADING THE RING ROOM`
 * slammed in (simply there under reduced motion), and under it, when there is one, a `DID YOU KNOW?` row.
 * A polite busy status until the scene's first frame is in; the caller removes it then.
 */
export function LoadingCard({ labels, tip }: LoadingCardProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={labels.loading}
      data-loading-card
      className={`${docket.docket} ${styles.card}`}
    >
      <div className={styles.stamp}>
        <Stamp
          size="md"
          tone="ink"
          rotation="auto"
          seed="ring-room"
          role={null}
          lines={[labels.loading]}
        />
      </div>
      {tip ? (
        <p data-did-you-know className={`${docket.row} ${styles.tip}`}>
          <span className={docket.label}>{labels.didYouKnow}</span>
          <span className={styles.line}>{tip}</span>
        </p>
      ) : null}
    </div>
  );
}
