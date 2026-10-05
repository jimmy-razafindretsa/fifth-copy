import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { ClerkSection } from "./clerk-section";
import { LiveFeed } from "./live-feed";
import { Star } from "./star";
import { TypingStrip } from "./typing-strip";

// Server render of the landing's client leaves (card 497): first paint carries the bible's structure.
describe("TypingStrip", () => {
  it("renders every character of the sentence, the first one as the next cell, no stamp", () => {
    const html = renderToStaticMarkup(<TypingStrip labels={en.landing.tape} />);
    expect(html.match(/data-state="/g)).toHaveLength(en.landing.tape.sentence.length);
    expect(html).toMatch(/data-state="next"[^>]*>T</);
    expect(html.match(/data-state="remaining"/g)).toHaveLength(en.landing.tape.sentence.length - 1);
    expect(html).toContain('aria-label="Typing practice"');
    expect(html).toContain(`maxLength="${en.landing.tape.sentence.length}"`);
    expect(html).toMatch(/<output[^>]*><\/output>/);
  });
});

describe("LiveFeed", () => {
  it("renders the LIVE badge, the room chip with the timecode, the caption and the three views", () => {
    const html = renderToStaticMarkup(
      <LiveFeed labels={en.landing.feed} roomNumber={457} elapsedSeconds={3725} />,
    );
    expect(html).toContain("ROOM 457 · 01:02:05");
    expect(html).toContain("STREAMING · Room 457, one of the ring rooms. Right now.");
    expect(html).toContain("CAM 02 · 30/30");
    expect(html).toContain('aria-pressed="true">AUTO<');
    expect(html).toContain("FREE VIEW");
    expect(html).toContain("FIRST PERSON");
    expect(html).toContain("ROOM 457<br/>30 SEATS");
    expect(html).toMatch(/<iframe[^>]*aria-hidden="true"/);
  });
});

describe("ClerkSection", () => {
  it("renders the pending personnel file for an unassigned visitor and the rank ladder", () => {
    const html = renderToStaticMarkup(
      <ClerkSection labels={en.landing.clerk} name={null} lockerHref="/locker" />,
    );
    expect(html).toContain("UNASSIGNED");
    expect(html.match(/<dd>…<\/dd>/g)).toHaveLength(5);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-current="step">RECRUIT<');
    expect(html).toContain("HERO OF PAPERWORK");
    expect(html).toContain('href="/locker"');
  });

  it("files the viewer's name when there is one", () => {
    const html = renderToStaticMarkup(
      <ClerkSection labels={en.landing.clerk} name="Comrade Sparrow-482" lockerHref="/locker" />,
    );
    expect(html).toContain("Comrade Sparrow-482");
    expect(html).not.toContain("UNASSIGNED");
  });
});

describe("Star", () => {
  it("is decorative, sized and timed per instance", () => {
    const html = renderToStaticMarkup(<Star size={64} tone="red" spin={50} at={{ left: "2%" }} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("width:64px");
    expect(html).toContain("animation-duration:50s");
    expect(html).toContain("left:2%");
  });
});
