import type { ReactNode } from "react";
import { getT } from "@/i18n";
import type { DawnReport } from "../view/dawn-report";
import { rankingRowsFrom } from "../view/ranking";
import { filingLabels, podiumLabels, rankingLabels } from "../view/report-labels";
import styles from "./dawn-report.module.css";
import { FilingNotice } from "./filing-notice";
import { Podium } from "./podium";
import { RankingTable } from "./ranking-table";

/**
 * The Dawn report's layout (bible 14.4), presentational: kicker, `RACE OVER`, then the body (the
 * podium, or the filing notice), and under the podium the ranking docket (#301) beside the personal
 * stats card (#302) from 1024px. Empty slots render nothing.
 */
export function DawnReportLayout({
  kicker,
  heading,
  children,
  ranking,
  personal,
}: {
  kicker: string;
  heading: string;
  children: ReactNode;
  ranking?: ReactNode;
  personal?: ReactNode;
}) {
  return (
    <div className={styles.screen} data-dawn-report>
      <p className={styles.kicker}>{kicker}</p>
      <h1 className={styles.heading}>{heading}</h1>
      <div className={styles.report}>
        {children}
        {(ranking || personal) && (
          <div className={styles.slots}>
            {ranking && <div data-slot="ranking">{ranking}</div>}
            {personal && <div data-slot="personal">{personal}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * `/results/[raceId]` (#300 C2, ARCHITECTURE 8.1, 8.3): the site header (as the waiting room keeps it),
 * then the report: the filing notice (the one client leaf that polls) or the podium with the ranking
 * docket (#301) in its slot.
 */
export async function DawnReportScreen({ report }: { report: DawnReport }) {
  // loaded at render: the internal result routes import this index too, and must not evaluate the header
  const [{ LandingHeader }, t] = await Promise.all([import("@/features/landing"), getT()]);
  const r = t.results;
  return (
    <>
      <LandingHeader />
      <main className="flex flex-1 flex-col">
        <DawnReportLayout
          kicker={r.kicker}
          heading={r.heading}
          ranking={
            report.kind === "report" ? (
              <RankingTable
                rows={rankingRowsFrom(report.entries, report.viewerDesk)}
                labels={rankingLabels(r)}
              />
            ) : undefined
          }
        >
          {report.kind === "filing" ? (
            <FilingNotice {...filingLabels(r, report.lobbyCode)} />
          ) : (
            <Podium
              entries={report.entries}
              viewerDesk={report.viewerDesk}
              labels={podiumLabels(r)}
            />
          )}
        </DawnReportLayout>
      </main>
    </>
  );
}
