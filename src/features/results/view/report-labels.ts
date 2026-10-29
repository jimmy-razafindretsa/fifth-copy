import type { Messages } from "@/i18n/en";
import type { PodiumLabels } from "./dawn-report";

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

/** The filing notice's strings; the way back goes to the waiting room when the lobby is known. */
export function filingLabels(results: Messages["results"], lobbyCode: string | null) {
  const { notice, prefix, late, lobby, home } = results.filing;
  const labels: FilingLabels = { notice, prefix, late, back: lobbyCode ? lobby : home };
  return { labels, backHref: lobbyCode ? `/lobby/${lobbyCode}` : "/" };
}
