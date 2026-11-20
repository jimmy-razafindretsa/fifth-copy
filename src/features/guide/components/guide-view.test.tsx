import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { GUIDE_CONTENT, withChecks } from "../content";
import { GuideView, type GuideDesk } from "./guide-view";

// #999 C26 states (default, unknown OS, unverified pair) and C27 (only a checked pair shows keys).

function render(desk: GuideDesk, content = GUIDE_CONTENT, t = en) {
  return renderToStaticMarkup(
    <GuideView
      header={null}
      labels={t.guide}
      layoutNames={t.settings.layout.names}
      content={content}
      desk={desk}
    />,
  );
}

const checkedCedilla = GUIDE_CONTENT.map((entry) =>
  entry.char === "ç"
    ? {
        ...entry,
        pairs: withChecks(entry.pairs, "ç", { ç: { CSA: { windows: { check: "G1" } } } }),
      }
    : entry,
);

describe("GuideView (#999 C26, C27)", () => {
  it("one anchored section per character, the index linking each anchor", () => {
    const html = render({ layout: "CSA", os: "windows", osSource: "detected" });
    for (const entry of GUIDE_CONTENT) {
      expect(html).toContain(`id="${entry.anchor}"`);
      expect(html).toContain(`href="#${entry.anchor}"`);
    }
    expect(html.match(/<h2 /g)).toHaveLength(GUIDE_CONTENT.length);
  });

  it("default: the detected OS row only, the layout and OS segments current, the state named", () => {
    const html = render({ layout: "AZERTY", os: "mac", osSource: "detected" });
    expect(html.match(/data-guide-pair="AZERTY\/mac"/g)).toHaveLength(GUIDE_CONTENT.length);
    expect(html).not.toContain('data-guide-pair="AZERTY/windows"');
    expect(html).toMatch(/aria-current="true"[^>]*data-guide-layout-option="AZERTY"/);
    expect(html).toMatch(/aria-current="true"[^>]*data-guide-os-option="mac"/);
    expect(html).toContain(en.guide.detected);
    // a detected OS stays out of the layout links; the OS links carry the layout
    expect(html).toContain('href="/guide?layout=CSA"');
    expect(html).toContain('href="/guide?layout=AZERTY&amp;os=windows"');
  });

  it("a chosen OS is kept by the layout links", () => {
    const html = render({ layout: "CSA", os: "chromeos", osSource: "chosen" });
    expect(html).toContain('href="/guide?layout=US_QWERTY&amp;os=chromeos"');
    expect(html).toContain(en.guide.chosen);
  });

  it("unknown OS: every OS per character, no OS segment current, the pick prompt", () => {
    const html = render({ layout: "US_QWERTY", os: null, osSource: null });
    for (const os of ["windows", "mac", "chromeos"]) {
      expect(html.match(new RegExp(`data-guide-pair="US_QWERTY/${os}"`, "g"))).toHaveLength(
        GUIDE_CONTENT.length,
      );
    }
    expect(html).not.toMatch(/aria-current="true"[^>]*data-guide-os-option/);
    expect(html).toContain(en.guide.unknown);
    expect(html).toContain("Nobody has typed these on a real US QWERTY keyboard yet.");
  });

  it("C27 an unverified pair shows the empty state and no key cap, never the candidate", () => {
    const html = render({ layout: "US_QWERTY", os: "mac", osSource: "detected" });
    expect(html).not.toContain("data-guide-keys");
    expect(html.match(/data-guide-unchecked=""/g)).toHaveLength(GUIDE_CONTENT.length);
    expect(html).toContain("Nobody has typed these on a real US QWERTY keyboard under MACOS yet.");
    expect(html).not.toContain("Option");
  });

  it("C27 a checked pair shows its keys; the rest of the pair stays empty", () => {
    const html = render({ layout: "CSA", os: "windows", osSource: "detected" }, checkedCedilla);
    expect(html.match(/data-guide-keys=""/g)).toHaveLength(1);
    expect(html).toMatch(/id="c-cedilla"[\s\S]*data-guide-keys=""[\s\S]*<kbd[^>]*>ç<\/kbd>/);
    expect(html.match(/data-guide-unchecked=""/g)).toHaveLength(GUIDE_CONTENT.length - 1);
    // the pair-level empty state goes once one character of the pair is checked
    expect(html).not.toContain("Nobody has typed these");
  });

  it("names modifiers in the reader's language", () => {
    const checked = GUIDE_CONTENT.map((entry) =>
      entry.char === "ë"
        ? {
            ...entry,
            pairs: withChecks(entry.pairs, "ë", { ë: { AZERTY: { windows: { check: "G3" } } } }),
          }
        : entry,
    );
    const html = render({ layout: "AZERTY", os: "windows", osSource: "chosen" }, checked, fr);
    expect(html).toMatch(
      /<kbd[^>]*>Maj<\/kbd>[\s\S]*<kbd[^>]*>\^<\/kbd>[\s\S]*puis[\s\S]*<kbd[^>]*>e<\/kbd>/,
    );
  });
});
