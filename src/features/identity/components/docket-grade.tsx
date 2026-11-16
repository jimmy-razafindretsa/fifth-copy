import { Suspense, use } from "react";
import { fill, spokenRank } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import { BOT_LEVELS, type BotLevel } from "@fifth-copy/engine";

/** What the tag draws: the stats feature's `RankStep` (`rankFor`, #945); only its rank is read. */
export type GradeStep = { rank: BotLevel };

/** The viewer's grade read (the stats feature's `getRank`), handed in by the route (ADR 0021). */
export type GradeSource = (viewer: { id: string }) => Promise<GradeStep | null>;

export type DocketGradeProps = {
  /** The pending read, from `gradeRead`; it never holds the page (#969 C4). */
  read: Promise<GradeStep | null>;
  /** The catalogs' rank names in `BOT_LEVELS` order (the one list, #945). */
  ranks: readonly string[];
  /** The link name's grade part, `, grade: {rank}` (#969 C2). */
  spoken: string;
  locale: Locale;
  className?: string | undefined;
};

/** A settled promise as React's `use` reads it: `status` and `value` set when it settles. */
type Tracked<T> = Promise<T> & { status?: "pending" | "fulfilled"; value?: T };

/**
 * Starts an account's docket grade read (#969 C4); null for a guest or a visitor. A failed read settles
 * to null (no tag, never an error page), and the promise is marked when it settles (`status`, `value`: what React's `use` reads), so a
 * read done by the time the docket renders is drawn at once, in the first paint, and only a slower one
 * suspends and streams in afterwards.
 */
export function gradeRead(
  source: GradeSource | undefined,
  viewer: { id: string; isGuest: boolean } | null,
): Promise<GradeStep | null> | null {
  // a guest has no grade (as the Home docket, #945) and a visitor no file: neither is read (#969 C3)
  if (!source || !viewer || viewer.isGuest) return null;
  const read: Tracked<GradeStep | null> = new Promise<GradeStep | null>((resolve) =>
    resolve(source(viewer)),
  ).catch(() => null);
  read.status = "pending";
  void read.then((value) => {
    read.status = "fulfilled";
    read.value = value;
  });
  return read;
}

/**
 * How long the header waits for the grade beside its avatar read (#969 C4): a read done by then is in
 * the first paint and nothing moves; a slower one streams into the tag's boundary, so the page is never
 * held longer than this.
 */
export const GRADE_GRACE_MS = 50;

/** Resolves when `read` has settled or `ms` have passed, whichever is first; never rejects. */
export function gradeGrace(read: Promise<unknown>, ms = GRADE_GRACE_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    read.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => (timer = setTimeout(resolve, ms))),
  ]).finally(() => clearTimeout(timer));
}

/**
 * The header docket's grade tag (#969; bible 14.1 item 1, reference `Profil.dc.html` lines 40-44): after
 * the name, the ink tag with the grade name. Streams in its own boundary with nothing visible in its
 * place; a failing read renders no tag. It also carries the docket link's spoken name, `named` (`My file,
 * <name>`), whole: `My file, <name>, grade: Officer` once the grade is in, `named` alone meanwhile or
 * without one. One visually hidden text, because the link is a flex row and a screen reader's name
 * puts a space between two of its items (`<name> , grade`).
 */
export function DocketGrade({ named, ...props }: DocketGradeProps & { named: string }) {
  return (
    <Suspense fallback={<span className="sr-only">{named}</span>}>
      <DocketGradeLoaded named={named} {...props} />
    </Suspense>
  );
}

/** The read: a step draws the tag; null (no grade, or a failed read) draws nothing (#969 C4). */
export function DocketGradeLoaded({
  read,
  named,
  ranks,
  spoken,
  locale,
  className,
}: DocketGradeProps & { named: string }) {
  const step = use(read);
  if (!step) return <span className="sr-only">{named}</span>;
  const name = ranks[BOT_LEVELS.indexOf(step.rank)] ?? step.rank;
  return (
    <>
      <span className="sr-only">{named + fill(spoken, { rank: spokenRank(name, locale) })}</span>
      <span className={className} aria-hidden="true" data-docket-grade={step.rank}>
        {name}
      </span>
    </>
  );
}
