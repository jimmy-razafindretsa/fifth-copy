import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { GUIDE_CONTENT, GUIDE_SOURCES } from "../content";
import { GuideView, type GuideDesk } from "./guide-view";

// #999 C26 states (default, unknown OS, a pair with nothing documented) and #1001 C7 (every documented
// pair shows its keys and the vendor-documentation note with its source links; an undocumented pair
// says so, never a guess).

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

describe("GuideView (#999 C26, #1001 C7)", () => {
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
    // US QWERTY is documented on every system: no empty state
    expect(html).not.toContain(en.guide.undocumentedTag);
  });

  it("C7 a documented pair shows its keys for every character, with the note and its sources", () => {
    const html = render({ layout: "US_QWERTY", os: "mac", osSource: "detected" });
    expect(html.match(/data-guide-keys=""/g)).toHaveLength(GUIDE_CONTENT.length);
    expect(html).not.toContain("data-guide-undocumented");
    expect(html).toContain("FROM THE VENDOR&#x27;S LAYOUT DOCUMENTATION");
    expect(html).toContain(`href="${GUIDE_SOURCES.macAccents}"`);
    expect(html).toContain(`href="${GUIDE_SOURCES.macViewer}"`);
    expect(html).not.toContain(`href="${GUIDE_SOURCES.chromebook}"`);
    expect(html).toMatch(
      /id="e-circumflex"[\s\S]*?<kbd[^>]*>Option<\/kbd>[\s\S]*?<kbd[^>]*>i<\/kbd>/,
    );
  });

  it("C7 the Windows CSA pair: its own keys, dead keys and AltGr, the Alt code where the layout has none", () => {
    const html = render({ layout: "CSA", os: "windows", osSource: "detected" });
    expect(html.match(/data-guide-keys=""/g)).toHaveLength(GUIDE_CONTENT.length);
    expect(html).toMatch(/id="c-cedilla"[\s\S]*?data-guide-keys=""[\s\S]*?<kbd[^>]*>ç<\/kbd>/);
    expect(html).toMatch(
      /id="guillemet-open"[\s\S]*?<kbd[^>]*>AltGr<\/kbd>[\s\S]*?<kbd[^>]*>z<\/kbd>/,
    );
    expect(html).toMatch(/id="oe-ligature"[\s\S]*?<kbd[^>]*>Alt<\/kbd>[\s\S]*?0156 \(keypad\)/);
    expect(html).toContain(`href="${GUIDE_SOURCES.windowsLayouts}"`);
    expect(html).toContain(`href="${GUIDE_SOURCES.windowsAltCodes}"`);
  });

  it("C7 a pair the vendor does not document says so, with the empty state, never a key cap", () => {
    const html = render({ layout: "CSA", os: "mac", osSource: "detected" });
    expect(html).not.toContain("data-guide-keys");
    expect(html.match(/data-guide-undocumented=""/g)).toHaveLength(GUIDE_CONTENT.length);
    expect(html).toContain(
      "The vendor publishes no key chart for a CANADIAN FRENCH (CSA) keyboard under MACOS.",
    );
    expect(html).not.toContain("data-guide-sources");
  });

  it("names modifiers in the reader's language", () => {
    const html = render({ layout: "AZERTY", os: "windows", osSource: "chosen" }, GUIDE_CONTENT, fr);
    expect(html).toMatch(
      /id="e-diaeresis"[\s\S]*?<kbd[^>]*>Maj<\/kbd>[\s\S]*?<kbd[^>]*>\^<\/kbd>[\s\S]*?puis[\s\S]*?<kbd[^>]*>e<\/kbd>/,
    );
    expect(html).toContain(fr.guide.sourceNote.replaceAll("'", "&#x27;"));
  });
});
