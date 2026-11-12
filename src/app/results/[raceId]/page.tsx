import { notFound } from "next/navigation";
import { getViewer } from "@/features/identity";
import { DawnReportScreen, getDawnReport, getPersonalReplay } from "@/features/results";

/**
 * `/results/[raceId]` (#300, ARCHITECTURE 8.1): the Dawn report of a race. Thin: the viewer (ADR 0009)
 * and the persisted report (ADR 0008) go to the results feature's screen; an id that names no race is a
 * 404. The viewer's guest flag picks the action row's prompt (#863). While the race server's results are on their way the screen shows the filing notice.
 * The personal card's WPM graph (#865), errors by key and tip (#867) read the viewer's own trace.
 */
export default async function ResultsPage({ params }: PageProps<"/results/[raceId]">) {
  const { raceId } = await params;
  const viewer = await getViewer();
  const [report, replay] = await Promise.all([
    getDawnReport(raceId, viewer),
    getPersonalReplay(raceId, viewer),
  ]);
  if (!report) notFound();
  return (
    <DawnReportScreen report={report} viewerIsGuest={viewer?.isGuest ?? false} replay={replay} />
  );
}
