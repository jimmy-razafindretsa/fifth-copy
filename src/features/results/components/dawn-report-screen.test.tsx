import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import type { DawnReport } from "../view/dawn-report";
import { dawnReportFixtures } from "../view/dawn-report-fixtures";
import { reportActions } from "../view/report-labels";
import { DawnReportLayout } from "./dawn-report-screen";
import { ReportActions } from "./report-actions";

// The fixtures read identity's barrel (outfitForDesk), server code that validates the env on import.
vi.mock("@/env", () => ({ env: {} }));

// #143 C4, #863 C2: the Dawn report's action row (bible 14.4): the list in order, RACE AGAIN as the 7.1
// primary stamp, the way home as the 7.1 secondary link, each 44px, full width under 640px; a guest
// member's prompt is one 7.4 docket row under them: one sentence and the secondary `OPEN A FILE →`.
type Report = Extract<DawnReport, { kind: "report" }>;
const base = dawnReportFixtures.full;
const make = (lobbyOpen: boolean, viewerDesk: number | null, lobbyCode = "KGB-4821"): Report => ({
  ...base,
  race: { ...base.race, lobbyOpen, lobbyCode },
  viewerDesk,
});

const render = (report: Report, viewerIsGuest = false, results = en.results) =>
  renderToStaticMarkup(
    <ReportActions actions={reportActions(results, { ...report, viewerIsGuest })} />,
  );

/** The `<a>` carrying `data-action="<kind>"`: its attributes (any order) and its text. */
const anchor = (html: string, kind: string) => {
  const tag = html.match(new RegExp(`<a [^>]*data-action="${kind}"[^>]*>([^<]*)</a>`));
  if (!tag) return null;
  const attr = (name: string) => tag[0].match(new RegExp(`${name}="([^"]*)"`))?.[1];
  return { href: attr("href"), className: attr("class") ?? "", text: tag[1] };
};

describe("ReportActions (#143 C4, #863 C2)", () => {
  it("renders RACE AGAIN as the primary stamp, then the front desk as the secondary link", () => {
    const html = render(make(true, 3));
    const again = anchor(html, "again")!;
    expect(again).toMatchObject({ href: "/lobby/KGB-4821", text: "RACE AGAIN" });
    expect(again.className).toMatch(/stamp/);
    const home = anchor(html, "home")!;
    expect(home).toMatchObject({ href: "/", text: "BACK TO THE FRONT DESK →" });
    expect(home.className).toMatch(/secondary/);
    expect(html.indexOf('data-action="again"')).toBeLessThan(html.indexOf('data-action="home"'));
    expect(html).not.toContain("data-prompt");
  });

  it("a closed lobby or a spectator: the secondary way home only", () => {
    for (const html of [render(make(false, 3)), render(make(true, null), true)]) {
      expect(html).toContain('data-action="home"');
      expect(html).not.toContain('data-action="again"');
      expect(html).not.toMatch(/class="[^"]*stamp/);
      expect(html).not.toContain("data-prompt");
    }
  });

  it("a guest member: the prompt row under the links, one sentence and OPEN A FILE → to /sign-up", () => {
    const html = render(make(true, 3), true);
    const at = (s: string) => html.indexOf(s);
    expect(at('data-action="home"')).toBeLessThan(at("data-prompt"));
    const prompt = html.slice(at("<p"), html.indexOf("</p>") + 4);
    expect(prompt).toMatch(/class="[^"]*prompt[^"]*"/);
    expect(prompt).toContain(`<span>${en.results.actions.prompt}</span>`);
    const signup = anchor(prompt, "signup")!;
    expect(signup).toMatchObject({ href: "/sign-up", text: "OPEN A FILE →" });
    expect(signup.className).toMatch(/secondary/);
    expect(en.results.actions.prompt.split(/[.!?](\s|$)/).filter((x) => x?.trim()).length).toBe(1);
    const french = render(make(true, 3), true, fr.results);
    expect(french).toContain(">OUVRIR UN DOSSIER →<");
    expect(french).toContain(fr.results.actions.prompt.replace("'", "&#x27;"));
  });

  it("sits under the ranking in the layout", () => {
    const html = renderToStaticMarkup(
      <DawnReportLayout
        kicker="K"
        heading="H"
        ranking={<p>RANKING</p>}
        actions={
          <ReportActions
            actions={reportActions(en.results, { ...make(true, 1), viewerIsGuest: true })}
          />
        }
      >
        <p>PODIUM</p>
      </DawnReportLayout>,
    );
    const at = (s: string) => html.indexOf(s);
    expect(at("PODIUM")).toBeLessThan(at("RANKING"));
    expect(at("RANKING")).toBeLessThan(at('data-slot="actions"'));
  });

  it("CSS: 44px targets, full width under 640px, the 7.1 stamp and the 7.4 docket row (bible 7, 18)", () => {
    const css = readFileSync(path.join(__dirname, "dawn-report.module.css"), "utf8");
    const rule = (name: string) => css.match(new RegExp(`\\.${name} \\{[^}]*\\}`))?.[0] ?? "";
    expect(rule("stamp")).toContain("min-height: 44px");
    expect(rule("stamp")).toContain("background: var(--color-primary)");
    expect(rule("stamp")).toContain("box-shadow: 6px 6px 0 var(--color-fg)");
    expect(rule("secondary")).toContain("min-height: 44px");
    expect(rule("secondary")).toContain("border: 2px solid var(--color-fg)");
    expect(rule("prompt")).toContain("border: 2px solid var(--color-fg)");
    expect(rule("prompt")).toContain("background: var(--color-surface)");
    expect(rule("prompt")).toContain("padding: 8px 12px");
    expect(css).toMatch(
      /@media \(max-width: 639px\) \{[^@]*\.actions > \*,\s*\.prompt > a \{[^}]*width: 100%/,
    );
  });
});
