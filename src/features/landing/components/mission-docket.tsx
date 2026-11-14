import { Suspense } from "react";
import { Star } from "@/components/ui";
import type { MissionProgress, Missions } from "@/features/stats";
import { fill } from "@/i18n/format";
import type { Messages } from "@/i18n/en";
import styles from "./home.module.css";

export type MissionLabels = Messages["home"]["mission"];

/**
 * The mission of the day docket (#943 C18, C20; bible "Home menu"): header, the day's line, the count
 * and one bar segment per target step. Streams in its own `Suspense` boundary; a rejected read (or no
 * viewer) renders nothing, so the menu never waits for it.
 */
export function MissionDocket(props: {
  load: () => Promise<Missions | null>;
  labels: MissionLabels;
}) {
  return (
    <Suspense fallback={null}>
      <MissionDocketLoaded {...props} />
    </Suspense>
  );
}

export async function MissionDocketLoaded({
  load,
  labels,
}: {
  load: () => Promise<Missions | null>;
  labels: MissionLabels;
}) {
  const missions = await load().catch(() => null);
  return missions ? <MissionDocketView mission={missions.today} labels={labels} /> : null;
}

export function MissionDocketView({
  mission,
  labels,
}: {
  mission: MissionProgress;
  labels: MissionLabels;
}) {
  const { id, target, progress, complete } = mission;
  return (
    <section
      className={styles.mission}
      aria-labelledby="mission-title"
      data-mission-docket={id}
      data-complete={complete ? "true" : "false"}
    >
      <div className={styles.missionHead}>
        <h2 id="mission-title" className={styles.missionTitle}>
          {labels.title}
        </h2>
        <span className={styles.missionCount} data-mission-count>
          {progress} / {target}
        </span>
      </div>
      <p className={styles.missionLine}>{labels.lines[id]}</p>
      <div
        role="progressbar"
        aria-label={labels.progressName}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={progress}
        className={styles.segments}
      >
        {Array.from({ length: target }, (_, i) => (
          <span key={i} className={styles.segment} data-done={i < progress ? "true" : "false"} />
        ))}
      </div>
      {complete ? (
        <span className={styles.missionDone} data-mission-done>
          <Star size={12} tone="gold" rotate={-8} />
          {labels.done}
          <span className={styles.missionPlus}>{labels.plus}</span>
        </span>
      ) : null}
    </section>
  );
}
