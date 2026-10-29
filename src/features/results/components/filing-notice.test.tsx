import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { filingLabels } from "../view/report-labels";
import { FILING_MAX_MS, FILING_REFRESH_MS, startFilingPoll } from "./filing-notice";
import { FilingNoticeView } from "./filing-notice-view";

// Contract of #300 C2 (unit half; e2e/results/podium.spec.ts drives the page): refresh every 2 s for at
// most 60 s, then the inline error line with the way back.
afterEach(() => vi.useRealTimers());

describe("filing notice (#300 C2)", () => {
  it("refreshes every 2 s and stops at 60 s with one expiry", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const onExpire = vi.fn();
    startFilingPoll({ refresh, onExpire });
    expect(FILING_REFRESH_MS).toBe(2_000);
    expect(FILING_MAX_MS).toBe(60_000);
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(56_000);
    expect(refresh).toHaveBeenCalledTimes(29);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    expect(refresh).toHaveBeenCalledTimes(29);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("the stop function cancels the poll", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const stop = startFilingPoll({ refresh, onExpire: vi.fn() });
    stop();
    vi.advanceTimersByTime(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("waiting: the one-row notice with role=status, in one language", () => {
    const { labels, backHref } = filingLabels(en.results, "KGB-4821");
    const html = renderToStaticMarkup(
      <FilingNoticeView labels={labels} backHref={backHref} late={false} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("FILING THE REPORT · ONE MOMENT");
    const frHtml = renderToStaticMarkup(
      <FilingNoticeView {...filingLabels(fr.results, null)} late={false} />,
    );
    expect(frHtml).toContain("DÉPÔT DU RAPPORT · UN INSTANT");
  });

  it("late: the inline error line and a link to the lobby, else to /", () => {
    const lobby = renderToStaticMarkup(
      <FilingNoticeView {...filingLabels(en.results, "KGB-4821")} late />,
    );
    expect(lobby).toContain('role="alert"');
    expect(lobby).toContain("RETURNED ·");
    expect(lobby).toContain('href="/lobby/KGB-4821"');
    expect(lobby).toContain("BACK TO THE WAITING ROOM →");
    const home = renderToStaticMarkup(
      <FilingNoticeView {...filingLabels(en.results, null)} late />,
    );
    expect(home).toContain('href="/"');
    expect(home).not.toContain('role="status"');
  });
});
