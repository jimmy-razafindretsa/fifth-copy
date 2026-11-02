import type { Messages } from "@/i18n/en";
import type { DawnReport, PodiumLabels } from "./dawn-report";
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

/** The filing notice's strings; the way back goes to the waiting room when the lobby is known. */
export function filingLabels(results: Messages["results"], lobbyCode: string | null) {
  const { notice, prefix, late, lobby, home } = results.filing;
  const labels: FilingLabels = { notice, prefix, late, back: lobbyCode ? lobby : home };
  return { labels, backHref: lobbyCode ? `/lobby/${lobbyCode}` : "/" };
}

/**
 * The Dawn report's one action (#143, bible 14.4 action row): `again`, the way back to the waiting
 * room for another race, only for a member of the race while its lobby is open; else `home`.
 */
export type ReportAction = { kind: "again" | "home"; label: string; href: string };

export function reportAction(
  results: Messages["results"],
  { race, viewerDesk }: Pick<Extract<DawnReport, { kind: "report" }>, "race" | "viewerDesk">,
): ReportAction {
  if (race.lobbyOpen && race.lobbyCode && viewerDesk !== null) {
    return { kind: "again", label: results.actions.again, href: `/lobby/${race.lobbyCode}` };
  }
  return { kind: "home", label: results.filing.home, href: "/" };
}
