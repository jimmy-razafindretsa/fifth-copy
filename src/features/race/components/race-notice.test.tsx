import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hudLabelFixtures, RACE_NOTICES } from "../view/hud-labels";
import { RaceNotice } from "./race-notice";

// Contract of #560 C6 (markup and CSS; the computed pulse and its stop are checked in e2e/race/hud.spec.ts).
const EN = hudLabelFixtures.en.notice;
const FR = hudLabelFixtures.fr.notice;
const html = (el: React.ReactElement) =>
  renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
const css = readFileSync(
  path.join(process.cwd(), "src/features/race/components/hud-docket.module.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("RaceNotice (#560 C6)", () => {
  it("covers the four notice kinds", () => {
    expect(RACE_NOTICES).toEqual(["waiting-for-host", "reconnecting", "idle-warning", "no-scene"]);
  });

  for (const kind of RACE_NOTICES) {
    it(`${kind}: a status row with its copy in the label language`, () => {
      const out = html(<RaceNotice kind={kind} labels={EN} />);
      expect(out).toMatch(new RegExp(`^<p[^>]*role="status"[^>]*data-notice="${kind}"`));
      expect(out).toContain(`>${EN[kind]}<`);
      expect(html(<RaceNotice kind={kind} labels={FR} />)).toContain(`>${FR[kind]}<`);
      // CSS module classes (`_notice_<hash>`): the 7.4 notice row and the pulse of hud-docket.module.css
      expect(out).toMatch(/class="[^"]*_notice_[^"]*_pulse_/);
    });
  }

  it("uses the bible 2 copy for waiting", () => {
    expect(html(<RaceNotice kind="waiting-for-host" labels={EN} />)).toContain(
      ">WAITING FOR THE HOST<",
    );
    expect(html(<RaceNotice kind="waiting-for-host" labels={FR} />)).toContain(
      ">EN ATTENTE DE L'HÔTE<",
    );
  });

  it("the idle warning is the urgent tone", () => {
    expect(html(<RaceNotice kind="idle-warning" labels={EN} />)).toContain('data-tone="urgent"');
    expect(html(<RaceNotice kind="reconnecting" labels={EN} />)).not.toContain("data-tone");
  });

  it("pulses with lkPulse 1.3s and holds still under reduced motion", () => {
    // the dip keeps ink text at 4.5:1 (0.75: 6.02 on paper, 4.91 on the light danger-surface)
    expect(css).toMatch(/@keyframes lkPulse \{\s*50% \{\s*opacity: 0\.75;/);
    expect(css).toMatch(/\.pulse \{\s*animation: lkPulse 1\.3s ease-in-out infinite;/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.pulse \{\s*animation: none;/,
    );
    expect(css).toMatch(/\[data-motion="reduce"\] \.pulse \{\s*animation: none;/);
  });
});
