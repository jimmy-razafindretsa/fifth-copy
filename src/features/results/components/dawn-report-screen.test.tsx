import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import type { DawnReport } from "../view/dawn-report";
import { dawnReportFixtures } from "../view/dawn-report-fixtures";
import { reportAction } from "../view/report-labels";
import { DawnReportLayout } from "./dawn-report-screen";
import { ReportActions } from "./report-actions";

// The fixtures read identity's barrel (outfitForDesk), server code that validates the env on import.
vi.mock("@/env", () => ({ env: {} }));

// #143 C4: the Dawn report's action row (bible 14.4 extension): the 7.1 primary stamp RACE AGAIN to
// the waiting room when the lobby is open and the viewer raced, else the 7.1 secondary way home.
type Report = Extract<DawnReport, { kind: "report" }>;
const base = dawnReportFixtures.full;
const make = (lobbyOpen: boolean, viewerDesk: number | null, lobbyCode = "KGB-4821"): Report => ({
  ...base,
  race: { ...base.race, lobbyOpen, lobbyCode },
  viewerDesk,
});

const render = (report: Report, results = en.results) =>
  renderToStaticMarkup(<ReportActions action={reportAction(results, report)} />);

describe("reportAction (#143 C4)", () => {
  it("RACE AGAIN to /lobby/[code] only for a member of the race while its lobby is open", () => {
    expect(reportAction(en.results, make(true, 3))).toEqual({
      kind: "again",
      label: "RACE AGAIN",
      href: "/lobby/KGB-4821",
    });
    expect(reportAction(fr.results, make(true, 3)).label).toBe("ENCORE UNE FOIS");
    for (const report of [make(false, 3), make(true, null), make(true, 3, "")]) {
      expect(reportAction(en.results, report)).toEqual({
        kind: "home",
        label: "BACK TO THE FRONT DESK →",
        href: "/",
      });
    }
    expect(reportAction(fr.results, make(false, 3)).label).toBe(fr.results.filing.home);
  });
});

describe("ReportActions (#143 C4)", () => {
  it("renders the primary stamp link for Race again, the secondary link otherwise", () => {
    const again = render(make(true, 3));
    expect(again).toContain('href="/lobby/KGB-4821"');
    expect(again).toContain('data-action="again"');
    expect(again).toMatch(/class="[^"]*stamp[^"]*"/);
    expect(again).toContain(">RACE AGAIN<");

    const home = render(make(false, 3));
    expect(home).toContain('href="/"');
    expect(home).toContain('data-action="home"');
    expect(home).toMatch(/class="[^"]*secondary[^"]*"/);
    expect(home).not.toMatch(/class="[^"]*stamp/);
  });

  it("sits under the ranking in the layout", () => {
    const html = renderToStaticMarkup(
      <DawnReportLayout
        kicker="K"
        heading="H"
        ranking={<p>RANKING</p>}
        actions={<ReportActions action={reportAction(en.results, make(true, 1))} />}
      >
        <p>PODIUM</p>
      </DawnReportLayout>,
    );
    const at = (s: string) => html.indexOf(s);
    expect(at("PODIUM")).toBeLessThan(at("RANKING"));
    expect(at("RANKING")).toBeLessThan(at('data-slot="actions"'));
  });

  it("CSS: 44px targets, full width on phones, the 7.1 stamp recipe (bible 7.1, 18)", () => {
    const css = readFileSync(path.join(__dirname, "dawn-report.module.css"), "utf8");
    const rule = (name: string) => css.match(new RegExp(`\\.${name} \\{[^}]*\\}`))?.[0] ?? "";
    expect(rule("stamp")).toContain("min-height: 44px");
    expect(rule("stamp")).toContain("background: var(--color-primary)");
    expect(rule("stamp")).toContain("box-shadow: 6px 6px 0 var(--color-fg)");
    expect(rule("secondary")).toContain("min-height: 44px");
    expect(css).toMatch(/@media \(max-width: 639px\) \{\s*\.actions > \* \{[^}]*width: 100%/);
  });
});
