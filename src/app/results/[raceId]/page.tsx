import { notFound } from "next/navigation";
import { getViewer } from "@/features/identity";
import { DawnReportScreen, getDawnReport } from "@/features/results";

/**
 * `/results/[raceId]` (#300, ARCHITECTURE 8.1): the Dawn report of a race. Thin: the viewer (ADR 0009)
 * and the persisted report (ADR 0008) go to the results feature's screen; an id that names no race is a
 * 404. While the race server's results are on their way the screen shows the filing notice.
 */
export default async function ResultsPage({ params }: PageProps<"/results/[raceId]">) {
  const { raceId } = await params;
  const report = await getDawnReport(raceId, await getViewer());
  if (!report) notFound();
  return <DawnReportScreen report={report} />;
}
