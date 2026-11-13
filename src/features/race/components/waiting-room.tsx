import type { CSSProperties } from "react";
import { fill } from "@/i18n/format";
import type { WaitingRoomView, WaitingStep } from "../view/waiting-room-view";
import docket from "./hud-docket.module.css";
import styles from "./waiting-room.module.css";

/** The `race.waiting` copy (#937, bible 7.4 "Waiting room"). */
export type WaitingRoomLabels = {
  /** `SUMMONS · ROOM {code}`. */
  kicker: string;
  heading: string;
  form: string;
  tag: string;
  rows: { room: string; text: string; language: string; desk: string; ready: string };
  textType: Record<NonNullable<WaitingRoomView["textType"]>, string>;
  language: Record<NonNullable<WaitingRoomView["language"]>, string>;
  steps: Record<WaitingStep, string>;
  phrases: Record<WaitingStep, string>;
  /** The progress bar's accessible name. */
  progress: string;
  arrivals: string;
  /** `desk {n}`. */
  desk: string;
  majorSays: string;
};

export type WaitingRoomProps = {
  labels: WaitingRoomLabels;
  view: WaitingRoomView;
  /** A live notice row at the top of the docket (C7: the line cut); `null` for none. */
  notice?: string | null;
  /** One "Did you know?" line, said by the Major; `null` hides the line. */
  tip?: string | null;
};

/** Rows the ARRIVALS band shows at once; more scroll in a loop (bible 7.4 "Waiting room"). */
export const ARRIVALS_VISIBLE = 3;

/**
 * The waiting room (#937, bible 7.4 "Waiting room", reference `docs/design/waiting-room/`): the summons
 * kicker, the `LOADING.` heading, the mission-order docket (a polite busy status: the rows, this
 * device's five load steps and its progress bar), the ARRIVALS ink band scrolling vertically through
 * the arrived typists, and the Major's line. Presentational; the leaf places it over the seat view.
 */
export function WaitingRoom({ labels, view, notice = null, tip = null }: WaitingRoomProps) {
  const rolling = view.arrivals.length > ARRIVALS_VISIBLE;
  const rows = (copy: boolean) =>
    view.arrivals.map((a) => (
      <li key={`${copy ? "c" : "a"}${a.desk}`} className={styles.arrival}>
        <span className={styles.who}>
          <span aria-hidden="true">★ </span>
          {a.name}
        </span>
        <span className={styles.where}>{fill(labels.desk, { n: a.desk })}</span>
      </li>
    ));
  const phrase = view.current ? labels.phrases[view.current] : labels.phrases.major;
  return (
    <section data-waiting-room aria-labelledby="waiting-room-heading" className={styles.room}>
      <div className={styles.column}>
        <p className={styles.kicker}>{fill(labels.kicker, { code: view.code ?? "" })}</p>
        <h2 id="waiting-room-heading" className={styles.heading}>
          {labels.heading}
        </h2>
        <div role="status" aria-busy="true" aria-label={labels.form} className={styles.docket}>
          {notice ? (
            <p data-notice="reconnecting" className={`${docket.notice} ${docket.pulse}`}>
              {notice}
            </p>
          ) : null}
          <div className={styles.head}>
            <span className={styles.form}>{labels.form}</span>
            <span className={docket.tag}>{labels.tag}</span>
          </div>
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt className={docket.label}>{labels.rows.room}</dt>
              <dd className={styles.value}>{view.code}</dd>
            </div>
            {view.textType ? (
              <div className={styles.row}>
                <dt className={docket.label}>{labels.rows.text}</dt>
                <dd className={styles.value}>{labels.textType[view.textType]}</dd>
              </div>
            ) : null}
            {view.language ? (
              <div className={styles.row}>
                <dt className={docket.label}>{labels.rows.language}</dt>
                <dd className={styles.value}>{labels.language[view.language]}</dd>
              </div>
            ) : null}
            {view.desk ? (
              <div data-desk className={styles.row}>
                <dt className={docket.label}>{labels.rows.desk}</dt>
                <dd className={`${styles.value} ${styles.you}`}>{view.desk}</dd>
              </div>
            ) : null}
            <div className={styles.row}>
              <dt className={docket.label}>{labels.rows.ready}</dt>
              <dd data-ready className={`${styles.value} ${styles.count}`}>
                {view.ready}
              </dd>
            </div>
          </dl>
          <div className={styles.progress}>
            <p className={styles.line}>
              <span data-phrase>{phrase}</span>
              <span data-percent className={styles.percent}>
                {view.percent} %
              </span>
            </p>
            <div
              role="progressbar"
              aria-label={labels.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={view.percent}
              className={styles.bar}
            >
              <span className={styles.fill} style={{ width: `${view.percent}%` }} />
            </div>
            <ol className={styles.steps}>
              {view.steps.map((s) => (
                <li key={s.id} data-step={s.id} data-step-state={s.state} className={styles.step}>
                  {s.state === "done" ? <span aria-hidden="true">✓ </span> : null}
                  {labels.steps[s.id]}
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div data-arrivals className={styles.band}>
          <p id="waiting-room-arrivals" className={styles.bandLabel}>
            {labels.arrivals}
          </p>
          <div
            role="region"
            aria-labelledby="waiting-room-arrivals"
            tabIndex={0}
            className={styles.viewport}
          >
            <div
              data-rolling={rolling ? "" : undefined}
              className={styles.track}
              style={{ "--_arrivals": view.arrivals.length } as CSSProperties}
            >
              <ul aria-labelledby="waiting-room-arrivals" className={styles.list}>
                {rows(false)}
              </ul>
              {rolling ? (
                <ul aria-hidden="true" data-loop className={`${styles.list} ${styles.loop}`}>
                  {rows(true)}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
        {tip ? (
          <p data-major className={styles.major}>
            <span className={styles.majorLabel}>{labels.majorSays}</span> {tip}
          </p>
        ) : null}
      </div>
    </section>
  );
}
