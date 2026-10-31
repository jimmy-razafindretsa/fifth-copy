import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { REPORT_STATUSES, type ReportEntry } from "../view/dawn-report";
import { rankingRowsFrom, type RankingRow } from "../view/ranking";
import { rankingLabels } from "../view/report-labels";
import { RankingTable } from "./ranking-table";

// Contract of #301 C2: a real <table> with its caption, scope="col" headers, one tr per row carrying
// data-place / data-you / data-status, the BOT, UNDER REVIEW and YOU tags, the initials (or an <img alt="">
// when an avatarUrl is given) and explicit table roles; no <div> table.
const EN = rankingLabels(en.results);
const FR = rankingLabels(fr.results);

const entry = (over: Partial<ReportEntry>): ReportEntry => ({
  desk: 1,
  name: "Lynx-785",
  isBot: false,
  place: 1,
  status: "FINISHED",
  wpm: 61.4,
  accuracy: 0.974,
  progress: 1,
  finishedAtMs: 48_200,
  suspicious: false,
  outfit: {
    hair: "crop",
    glasses: "none",
    hat: "none",
    clothes: "shirt",
    face: "none",
    hairCol: "x",
  },
  ...over,
});

const ENTRIES: ReportEntry[] = [
  entry({ desk: 7, name: "Lynx-785", place: 1 }),
  entry({ desk: 3, name: "Typist Bot 2", isBot: true, place: 2, wpm: 54.2, status: "EXPIRED" }),
  entry({ desk: 12, name: "Heron-302", place: 3, status: "ASLEEP" }),
  entry({ desk: 4, name: "Otter-417", place: 4, status: "LINE_CUT" }),
  entry({ desk: 9, name: "Badger-126", place: 5, status: "TIMED_OUT" }),
  entry({ desk: 6, name: "Crow-559", place: 6, status: "REASSIGNED", suspicious: true }),
];

const render = (rows: RankingRow[], labels = EN) =>
  renderToStaticMarkup(<RankingTable rows={rows} labels={labels} />);

/** The markup of each body row, in DOM order. */
const bodyRows = (html: string) =>
  html
    .split("<tbody")[1]!
    .split(/(?=<tr )/)
    .slice(1);
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");

describe("RankingTable (#301 C2)", () => {
  const html = render(rankingRowsFrom(ENTRIES, 12));

  it("is a real table with a caption and explicit roles, inside a named focusable region", () => {
    expect(html).toMatch(/^<div [^>]*role="region"[^>]*tabindex="0"[^>]*aria-labelledby="([^"]+)"/);
    const id = html.match(/aria-labelledby="([^"]+)"/)![1]!;
    expect(html).toMatch(new RegExp(`<caption id="${id}"[^>]*>.*FORM 5-R · RANKING.*</caption>`));
    expect(html).toMatch(/<table [^>]*role="table"/);
    expect(html.match(/<thead [^>]*role="rowgroup"/g)).toHaveLength(1);
    expect(html.match(/<tbody role="rowgroup"/g)).toHaveLength(1);
    expect(html.match(/<tr [^>]*role="row"/g)).toHaveLength(7);
    expect(html.match(/<td [^>]*role="cell"/g)).toHaveLength(6 * 7);
    // no div table: the only div is the scrolling docket around the table
    expect(html.match(/<div/g)).toHaveLength(1);
  });

  it("has six scope=col column headers in order", () => {
    const ths = [...html.matchAll(/<th ([^>]*)>([^<]*)<\/th>/g)];
    expect(ths.map((m) => m[2])).toEqual(["PLACE", "TYPIST", "DESK", "WPM", "ACCURACY", "STATUS"]);
    for (const m of ths) {
      expect(m[1]).toContain('scope="col"');
      expect(m[1]).toContain('role="columnheader"');
    }
  });

  it("one tr per row in place order with data-place, data-you and data-status", () => {
    const rows = bodyRows(html);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.match(/data-place="(\d+)"/)![1])).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
    ]);
    expect(rows.map((r) => r.match(/data-you="(\w+)"/)![1])).toEqual([
      "false",
      "false",
      "true",
      "false",
      "false",
      "false",
    ]);
    expect(rows.map((r) => r.match(/data-status="(\w+)"/)![1])).toEqual([
      "FINISHED",
      "EXPIRED",
      "ASLEEP",
      "LINE_CUT",
      "TIMED_OUT",
      "REASSIGNED",
    ]);
  });

  it("each row reads place, name, desk, clean WPM, accuracy and the status in words", () => {
    const [first, bot, viewer, , , review] = bodyRows(html).map(text);
    expect(first).toBe("01LLynx-785DESK 0761" + "97 %" + "FILED");
    expect(bot).toContain("Typist Bot 2BOT");
    expect(bot).toContain("EXPIRED");
    expect(viewer).toContain("Heron-302YOU");
    expect(viewer).toContain("ASLEEP AT DESK");
    expect(review).toContain("Crow-559UNDER REVIEW");
    expect(review).toContain("REASSIGNED");
    const tags = (r: string) => (r.match(/class="[^"]*tag[^"]*"/g) ?? []).length;
    expect(bodyRows(html).map(tags)).toEqual([0, 1, 1, 0, 0, 1]);
  });

  it("every status reads in both catalogs", () => {
    for (const labels of [EN, FR]) {
      const out = render(
        rankingRowsFrom(
          REPORT_STATUSES.map((status, i) => entry({ desk: i + 1, place: i + 1, status })),
          null,
        ),
        labels,
      );
      for (const s of REPORT_STATUSES) expect(text(out)).toContain(labels.status[s]);
    }
  });

  it('the portrait shows the initials, or an <img alt=""> when avatarUrl is given', () => {
    const [first] = bodyRows(html);
    expect(first).toMatch(/data-col="portrait"><span [^>]*><span aria-hidden="true">L<\/span>/);
    const rows = rankingRowsFrom(ENTRIES.slice(0, 1), null).map((r) => ({
      ...r,
      avatarUrl: "/avatars/abc",
    }));
    const withImg = bodyRows(render(rows))[0]!;
    expect(withImg).toMatch(/<img src="\/avatars\/abc" alt=""/);
    expect(text(withImg)).toMatch(/^01Lynx-785/);
  });

  it("speaks French from the French catalog, one language per block", () => {
    const out = render(rankingRowsFrom(ENTRIES, 12), FR);
    expect(out).toContain("FORMULAIRE 5-R · CLASSEMENT");
    expect([...out.matchAll(/<th [^>]*>([^<]*)<\/th>/g)].map((m) => m[1])).toEqual([
      "RANG",
      "DACTYLO",
      "BUREAU",
      "MPM",
      "PRÉCISION",
      "STATUT",
    ]);
    expect(text(out)).toContain("Heron-302TOI");
    expect(text(out)).toContain("BUREAU 12");
    expect(text(out)).toContain("EN VÉRIFICATION");
    expect(text(out)).not.toMatch(/\bDESK\b|\bYOU\b|UNDER REVIEW|RANKING/);
  });

  it("a spectator sees no YOU row; an empty report renders the headers only", () => {
    expect(render(rankingRowsFrom(ENTRIES, null))).not.toContain('data-you="true"');
    expect(bodyRows(render([]))).toHaveLength(0);
  });
});
