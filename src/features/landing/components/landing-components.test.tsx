import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Star } from "@/components/ui";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { LINKS } from "../links";
import { ClerkSection } from "./clerk-section";
import { FooterView } from "./landing-footer";
import { LiveFeed } from "./live-feed";
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
    // #552: a recorded loop, not the 3D embed; the server renders its poster only
    expect(html).toMatch(
      /<video[^>]*poster="\/media\/live-feed\/poster.webp"[^>]*aria-hidden="true"/,
    );
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("/3d/lobby.html");
  });
});

describe("ClerkSection", () => {
  it("renders the pending personnel file for an unassigned visitor and the rank ladder", () => {
    const html = renderToStaticMarkup(
      <ClerkSection
        labels={en.landing.clerk}
        name={null}
        lockerHref={LINKS.locker ?? null}
        savedOutfit={null}
        save={null}
      />,
    );
    expect(html).toContain("UNASSIGNED");
    expect(html.match(/<dd>…<\/dd>/g)).toHaveLength(5);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-current="step">RECRUIT<');
    expect(html).toContain("HERO OF PAPERWORK");
    // #875 C2: the locker is post-v1, so the file carries no OPEN THE LOCKER button
    expect(html).toContain("REISSUE UNIFORM");
    expect(html).not.toContain(en.landing.clerk.locker);
    expect(html).not.toContain('href="/locker"');
  });

  it("offers OPEN THE LOCKER once the locker's route ships (#875)", () => {
    const html = renderToStaticMarkup(
      <ClerkSection
        labels={en.landing.clerk}
        name={null}
        lockerHref="/locker"
        savedOutfit={null}
        save={null}
      />,
    );
    expect(html).toMatch(/href="\/locker"[^>]*>OPEN THE LOCKER →</);
  });

  it("files the viewer's name when there is one", () => {
    const html = renderToStaticMarkup(
      <ClerkSection
        labels={en.landing.clerk}
        name="Comrade Sparrow-482"
        lockerHref={null}
        savedOutfit={null}
        save={null}
      />,
    );
    expect(html).toContain("Comrade Sparrow-482");
    expect(html).not.toContain("UNASSIGNED");
  });
});

// #875 C2: a link appears when its route ships; the footer offers only those (/privacy shipped, #76;
// the Personnel file, #932).
const HELD_BACK = ["/locker", "/teachers", "/about", "/terms", "/contact"];

describe("FooterView (#875)", () => {
  for (const [locale, t] of [
    ["en", en],
    ["fr", fr],
  ] as const) {
    it(`C2 ${locale}: PLAY, LEARN and AEGIS CORP. with shipped entries only, no social row`, () => {
      const f = t.landing.footer;
      const html = renderToStaticMarkup(<FooterView brand={t.brand} labels={f} />);
      for (const href of HELD_BACK) expect(html).not.toContain(`href="${href}"`);
      expect(html).not.toMatch(/href="https?:/);
      expect(html).not.toContain("<ul");
      // the brand column, the gold stamp and the bottom bar stay
      expect(html).toContain(t.brand.tagline);
      expect(html).toContain(f.about);
      expect(html).toContain(`${f.builtBy}<br/>${f.builtByName}`);
      expect(html).toContain(f.copyright);
      // three columns: PLAY (three race entries), LEARN (the guide and the Personnel file, #932) and
      // AEGIS CORP. (privacy, #76)
      const navs = [...html.matchAll(/<nav[^>]*aria-label="([^"]+)"[^>]*>(.*?)<\/nav>/g)];
      expect(navs.map((n) => n[1])).toEqual([f.play, f.learn, f.aegis]);
      expect([...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((h) => h[1])).toEqual([
        f.play,
        f.learn,
        f.aegis,
      ]);
      expect(navs[0]![2]!.match(/<a /g)).toHaveLength(3);
      expect(navs[1]![2]).toContain(`href="/#how"`);
      expect(navs[1]![2]!.match(/<a /g)).toHaveLength(2);
      expect(navs[1]![2]).toContain(`href="/profile"`);
      expect(navs[2]![2]!.match(/<a /g)).toHaveLength(1);
      expect(navs[2]![2]).toContain(`href="/privacy"`);
      for (const held of [f.links.locker, f.links.teachers, f.links.about]) {
        expect(html).not.toContain(`>${held}<`);
      }
    });
  }

  it("brings an entry, its column and the social row back once they exist", () => {
    const html = renderToStaticMarkup(
      <FooterView
        brand={en.brand}
        labels={en.landing.footer}
        links={{ ...LINKS, terms: "/terms" }}
        social={[{ key: "github", tag: "GH", href: "https://github.com/aegis-corp" }]}
      />,
    );
    expect(html).toContain('aria-label="AEGIS CORP."');
    expect(html).toMatch(/href="\/privacy"[^>]*>Privacy · Law 25</);
    expect(html).toContain('href="/terms"');
    expect(html).not.toContain('href="/about"');
    expect(html).toMatch(/<ul[^>]*><li><a href="https:\/\/github.com\/aegis-corp" target="_blank"/);
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
