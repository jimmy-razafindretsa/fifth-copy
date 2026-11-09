import Link from "next/link";
import { Suspense } from "react";
import type { ListOpenLobbiesResult, OpenLobby } from "@/features/lobby";
import { fill } from "@/i18n/format";
import type { Messages } from "@/i18n/en";
import styles from "./open-rooms.module.css";

export type OpenRoomsLabels = Messages["landing"]["rooms"];
export type OpenRoomsErrors = Pick<Messages["landing"]["errors"], "prefix" | "unavailable">;
type Labels = { labels: OpenRoomsLabels; errors: OpenRoomsErrors };

/** At most this many rows (#807 C1); the query already orders them busiest first. */
export const OPEN_ROOMS_MAX = 5;

const HEADING_ID = "open-rooms-title";

/** zero / one / other, as the catalogs spell them (French takes the singular for zero). */
function counted(forms: OpenRoomsLabels["typists"], n: number): string {
  return fill(n === 0 ? forms.zero : n === 1 ? forms.one : forms.other, { n });
}

/**
 * The landing's open-rooms docket (#807, bible 14.1 "Open rooms docket", 7.4): a header row (mono
 * title, Oswald `LIVE` tag) over the rows. It streams in its own `Suspense` boundary, so the rest of the
 * landing never waits for the race server; `load` is the lobby feature's `listOpenLobbies`, passed by
 * the route (a component never imports a feature's server entry, ADR 0021). It only shows the answer:
 * what is joinable is the query's decision.
 */
export function OpenRooms({
  load,
  ...labels
}: Labels & { load: () => Promise<ListOpenLobbiesResult> }) {
  return (
    <Suspense fallback={<OpenRoomsSkeleton labels={labels.labels} />}>
      <OpenRoomsLoaded load={load} {...labels} />
    </Suspense>
  );
}

/** Awaits the query, then renders its answer (exported for the unit tests). */
export async function OpenRoomsLoaded({
  load,
  ...labels
}: Labels & { load: () => Promise<ListOpenLobbiesResult> }) {
  return <OpenRoomsDocket result={await load()} {...labels} />;
}

function Docket({ labels, children }: { labels: OpenRoomsLabels; children: React.ReactNode }) {
  return (
    <section className={styles.docket} aria-labelledby={HEADING_ID} data-open-rooms>
      <div className={styles.head}>
        <h2 id={HEADING_ID} className={styles.title}>
          {labels.title}
        </h2>
        <span className={styles.tag}>{labels.live}</span>
      </div>
      {children}
    </section>
  );
}

/** Loading: three 7.4 skeleton rows, flat newsprint blocks, the list `aria-busy`. */
export function OpenRoomsSkeleton({ labels }: { labels: OpenRoomsLabels }) {
  return (
    <Docket labels={labels}>
      <ul className={styles.list} aria-label={labels.listName} aria-busy="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className={styles.row} aria-hidden="true" data-skeleton>
            <span className={styles.block} />
            <span className={`${styles.block} ${styles.blockWide}`} />
          </li>
        ))}
      </ul>
      <p className="sr-only">{labels.loading}</p>
    </Docket>
  );
}

/** One `120px | 1fr` row: the code, then the counts and the ink `JOIN →` link. */
function OpenRoomRow({ room, labels }: { room: OpenLobby; labels: OpenRoomsLabels }) {
  return (
    <li className={styles.row}>
      <span className={styles.code}>{room.code}</span>
      <span className={styles.cell}>
        <span className={styles.count}>
          {fill(labels.count, {
            typists: counted(labels.typists, room.typists),
            bots: counted(labels.bots, room.bots),
          })}
        </span>
        <Link
          href={`/lobby/${room.code}`}
          className={styles.join}
          aria-label={fill(labels.joinName, { code: room.code })}
        >
          {labels.join}
        </Link>
      </span>
    </li>
  );
}

/** The populated, empty and error states of the docket for one answer of the query. */
export function OpenRoomsDocket({
  result,
  labels,
  errors,
}: Labels & { result: ListOpenLobbiesResult }) {
  if (!result.ok) {
    return (
      <Docket labels={labels}>
        <p role="alert" className={styles.error}>
          <span className={styles.errorPrefix}>{errors.prefix}</span> {errors.unavailable}
        </p>
      </Docket>
    );
  }
  if (result.lobbies.length === 0) {
    return (
      <Docket labels={labels}>
        <p className={styles.notice}>{labels.empty}</p>
      </Docket>
    );
  }
  return (
    <Docket labels={labels}>
      <ul className={styles.list} aria-label={labels.listName}>
        {result.lobbies.slice(0, OPEN_ROOMS_MAX).map((room) => (
          <OpenRoomRow key={room.code} room={room} labels={labels} />
        ))}
      </ul>
    </Docket>
  );
}
