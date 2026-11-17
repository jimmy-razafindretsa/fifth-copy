import { LandingHeader } from "@/features/landing";
import { getRank } from "@/features/stats/server";

/**
 * The site header as every route shows it (bible 14.1 item 1): the landing header with the account's
 * grade tag (#969) fed by the stats feature's `getRank`. Composed here because the landing never imports
 * stats (ADR 0021; stats reads through results, which shows this header).
 */
/** The header's grade source, for routes whose screen draws the header itself (landing, Dawn Report). */
export const headerGrade = getRank;

export function SiteHeader({ current }: { current?: "profile" | "landing" } = {}) {
  return <LandingHeader current={current} grade={getRank} />;
}
