import type { Messages } from "@/i18n/en";
import type { DawnReport, PodiumLabels, ReportStatus } from "./dawn-report";
import type { BonusKind } from "./personal";
import type { RankingLabels } from "./ranking";

/** The filing notice's copy (#300 C2). */
export type FilingLabels = {
  notice: string;
  prefix: string;
  late: string;
  /** The link back: to the waiting room when the lobby is known, else to the front desk (`/`). */
  back: string;
};

/** The catalog's `results` strings as the podium's labels (ADR 0010). */
export function podiumLabels(results: Messages["results"]): PodiumLabels {
  return { ...results.podium, status: results.status };
}

/** The catalog's `results` strings as the ranking docket's labels (#301; the desk cell reads as the podium's). */
export function rankingLabels(results: Messages["results"]): RankingLabels {
  const { caption, place, typist, desk, wpm, accuracy, status, bot, you, underReview } =
    results.ranking;
  return {
    caption,
    columns: { place, typist, desk, wpm, accuracy, status },
    deskNumber: results.podium.desk,
    bot,
    you,
    underReview,
    status: results.status,
  };
}

/** The personal stats card's copy (#864, bible 14.4 "Personal stats card"). */
export type PersonalLabels = {
  /** The header's ink tag and the card's accessible name: `FORM 5-R · YOUR COPY`. */
  tag: string;
  /** `№ {n}` (the plinth tag, language-neutral). */
  place: string;
  wpm: string;
  accuracy: string;
  underReview: string;
  sent: string;
  received: string;
  none: string;
  /** `× {n}` */
  count: string;
  status: Record<ReportStatus, string>;
  /** The Sabotage tray's card names (bible 7.4). */
  bonus: Record<BonusKind, string>;
};

/** The catalog's strings as the personal card's labels: its own, the podium's figures, the tray's names. */
export function personalLabels(t: Pick<Messages, "results" | "race">): PersonalLabels {
  const { place, wpm, accuracy, underReview } = t.results.podium;
  const { cards } = t.race.sabotageTray;
  return {
    ...t.results.personal,
    place,
    wpm,
    accuracy,
    underReview,
    status: t.results.status,
    bonus: {
      "extra-paperwork": cards["extra-paperwork"].name,
      exemption: cards.exemption.name,
      "smoke-break": cards["smoke-break"].name,
    },
  };
}

/** The filing notice's strings; the way back goes to the waiting room when the lobby is known. */
export function filingLabels(results: Messages["results"], lobbyCode: string | null) {
  const { notice, prefix, late, lobby, home } = results.filing;
  const labels: FilingLabels = { notice, prefix, late, back: lobbyCode ? lobby : home };
  return { labels, backHref: lobbyCode ? `/lobby/${lobbyCode}` : "/" };
}

/**
 * The Dawn report's action row (#143, #863, bible 14.4 action row), as an ordered list. `again` (the way
 * back to the waiting room for another race) only for a member of the race (the viewer has a desk) while
 * its lobby is open, then `home` (the front desk) for everyone; a guest member also gets `signup`, the
 * prompt to open a file (`/sign-up`) so the results stay theirs (ADR 0009: the merge carries them). One
 * entry per link, so a later `PERSONNEL FILE` is one more entry here.
 */
export type ReportAction =
  | { kind: "again" | "home"; label: string; href: string }
  | { kind: "signup"; label: string; href: string; prompt: string };

export type ReportActionKind = ReportAction["kind"];

export function reportActions(
  results: Messages["results"],
  {
    race,
    viewerDesk,
    viewerIsGuest,
  }: Pick<Extract<DawnReport, { kind: "report" }>, "race" | "viewerDesk"> & {
    /** The viewer is a guest (ADR 0009); `false` for an account and for no identity at all. */
    viewerIsGuest: boolean;
  },
): ReportAction[] {
  const member = viewerDesk !== null;
  const actions: ReportAction[] = [];
  if (member && race.lobbyOpen && race.lobbyCode) {
    actions.push({ kind: "again", label: results.actions.again, href: `/lobby/${race.lobbyCode}` });
  }
  actions.push({ kind: "home", label: results.filing.home, href: "/" });
  if (member && viewerIsGuest) {
    const { signup, prompt } = results.actions;
    actions.push({ kind: "signup", label: signup, href: "/sign-up", prompt });
  }
  return actions;
}
