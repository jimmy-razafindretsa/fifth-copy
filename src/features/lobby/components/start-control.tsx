import { cn } from "@/lib/cn";
import { InlineError } from "./inline-error";
import type { LobbyLabels } from "./lobby-labels";
import entry from "./lobby-entry.module.css";
import styles from "./lobby.module.css";

/** The `host:start` refusals the host can act on (`not-host` hides the button instead), plus `timeout`. */
export type StartError = keyof LobbyLabels["start"]["errors"];

/** A race needs two seated typists, bots included (ARCHITECTURE 7.1, the server rule of #166). */
export const MIN_TYPISTS = 2;

const NOTE_ID = "lobby-start-note";
const ERROR_ID = "lobby-start-error";

/**
 * The host's START (#214 C8): the bible 7.1 primary stamp button under the roll, disabled with the line
 * `TWO TYPISTS NEEDED` below two seated typists, `STARTING…` and busy while the start is on its way, and
 * a 7.4 inline error line under it for each refusal. No hooks; the waiting room owns the state. Its
 * place in the full lobby layout is #498's.
 */
export function StartControl({
  seated,
  pending,
  error,
  labels,
  prefix,
  onStart,
}: {
  seated: number;
  pending: boolean;
  error: StartError | null;
  labels: LobbyLabels["start"];
  /** The rejection word of the inline error line (`RETURNED ·`). */
  prefix: string;
  onStart?: () => void;
}) {
  const ready = seated >= MIN_TYPISTS;
  const describedBy = !ready ? NOTE_ID : error ? ERROR_ID : undefined;
  return (
    <div data-start className={styles.start}>
      <button
        type="button"
        className={cn(entry.stamp, styles.startButton)}
        disabled={!ready || pending}
        aria-busy={pending || undefined}
        aria-describedby={describedBy}
        onClick={onStart}
      >
        {pending ? labels.pending : labels.button}
      </button>
      {!ready ? (
        <p id={NOTE_ID} className={styles.startNote}>
          {labels.needTwo}
        </p>
      ) : null}
      {error ? (
        <InlineError id={ERROR_ID} prefix={prefix}>
          {labels.errors[error]}
        </InlineError>
      ) : null}
    </div>
  );
}
