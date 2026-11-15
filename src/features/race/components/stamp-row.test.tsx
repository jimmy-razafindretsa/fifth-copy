import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { StampRow, stampText } from "./stamp-row";

// #232 C2 at unit level: the markup of each stamp. The live stamps, the slam, reduced motion and the
// layout are e2e/race/overtake.spec.ts.
describe("StampRow (#232 C2)", () => {
  const html = (stamp: Parameters<typeof StampRow>[0]["stamp"], labels = en.race.stamps, wpm = 0) =>
    renderToStaticMarkup(<StampRow stamp={stamp} wpm={wpm} labels={labels} />);

  it("renders nothing without a stamp", () => {
    expect(html(null)).toBe("");
  });

  // #951 (owner): an overtake is one plain line naming the other typist, not the dual Russian stamp
  const line = (
    stamp: Parameters<typeof StampRow>[0]["stamp"],
    otherName: string | null,
    labels = en.race.stamps,
  ) => renderToStaticMarkup(<StampRow stamp={stamp} labels={labels} otherName={otherName} />);

  it("an overtake reads one plain line, red for you, hidden from assistive tech, no Russian", () => {
    const out = line({ id: 7, kind: "overtake", errors: 0 }, "Bennett");
    expect(out).toContain('data-stamps="overtake"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('data-tone="red"');
    expect(out).toContain(">You overtook Bennett<");
    expect(out).not.toContain('lang="ru"');
    expect(out).not.toContain("data-stamp-size");
  });

  it("passed: `{name} overtook you` in ink; an unknown desk reads a typist", () => {
    const out = line({ id: 8, kind: "passed", errors: 0 }, "Carter");
    expect(out).toContain('data-tone="ink"');
    expect(out).toContain(">Carter overtook you<");
    expect(line({ id: 8, kind: "passed", errors: 0 }, null)).toContain(">A typist overtook you<");
  });

  it("French", () => {
    expect(line({ id: 1, kind: "overtake", errors: 0 }, "Foster", fr.race.stamps)).toContain(
      ">Tu as dépassé Foster<",
    );
    expect(line({ id: 1, kind: "passed", errors: 0 }, "Foster", fr.race.stamps)).toContain(
      ">Foster t&#x27;a dépassé<",
    );
  });
});

// #240 C2 at unit level: the finish stamps of bible 7.7, through the same row (the #232 queue).
describe("StampRow finish stamps (#240 C2)", () => {
  const html = (
    stamp: Parameters<typeof StampRow>[0]["stamp"],
    wpm: number,
    labels = en.race.stamps,
  ) => renderToStaticMarkup(<StampRow stamp={stamp} wpm={wpm} labels={labels} />);

  it("ACCEPTED · {wpm} WPM with zero errors: the red md stamp (you), one line, no Russian", () => {
    const out = html({ id: 3, kind: "accepted", errors: 0 }, 48);
    expect(out).toContain('data-stamps="accepted"');
    expect(out).toContain('data-stamp-tone="red"');
    expect(out).toContain('data-stamp-size="md"');
    expect(out).toContain("ACCEPTED · 48 WPM");
    expect(out).not.toContain('lang="ru"');
    expect(out).toContain('aria-hidden="true"');
  });

  it("RETURNED · {n} ERRORS: the ink stamp (neutral paperwork); one error reads singular", () => {
    const out = html({ id: 4, kind: "returned", errors: 2 }, 48);
    expect(out).toContain('data-stamps="returned"');
    expect(out).toContain('data-stamp-tone="ink"');
    expect(out).toContain("RETURNED · 2 ERRORS");
    expect(html({ id: 4, kind: "returned", errors: 1 }, 48)).toContain("RETURNED · 1 ERROR<");
  });

  it("French: ACCEPTÉ · 48 MPM, RETOURNÉ · 2 FAUTES (bible 2)", () => {
    expect(html({ id: 1, kind: "accepted", errors: 0 }, 48, fr.race.stamps)).toContain(
      "ACCEPTÉ · 48 MPM",
    );
    expect(html({ id: 1, kind: "returned", errors: 2 }, 48, fr.race.stamps)).toContain(
      "RETOURNÉ · 2 FAUTES",
    );
    expect(html({ id: 1, kind: "returned", errors: 1 }, 48, fr.race.stamps)).toContain(
      "RETOURNÉ · 1 FAUTE<",
    );
  });

  it("stampText is the stamp's line in words (the announcer reads it)", () => {
    expect(stampText({ kind: "accepted", errors: 0 }, 52, en.race.stamps)).toBe(
      "ACCEPTED · 52 WPM",
    );
    expect(stampText({ kind: "overtake", errors: 0 }, 52, en.race.stamps, "Bennett")).toBe(
      "You overtook Bennett",
    );
  });
});

// #868 C2 at unit level: the NEW HOST notice through the same row (the #232 queue holds it 3 s).
describe("StampRow NEW HOST (#868 C2)", () => {
  const html = (name: string, labels = en.race.stamps) =>
    renderToStaticMarkup(
      <StampRow stamp={{ id: 4, kind: "new-host", errors: 0, name }} labels={labels} />,
    );

  it("the ink md stamp NEW HOST: <NAME>, the name upper case, hidden and never focusable", () => {
    const out = html("Heron-411");
    expect(out).toContain('data-stamps="new-host"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('data-stamp-tone="ink"');
    expect(out).toContain('data-stamp-size="md"');
    expect(out).toContain("NEW HOST: HERON-411");
    expect(out).not.toMatch(/tabindex|<button|<a |role=/);
  });

  it("French: NOUVEL HÔTE : <NOM>, the lobby's own strings (#137)", () => {
    expect(html("Bea", fr.race.stamps)).toContain("NOUVEL HÔTE : BEA");
    expect(en.race.stamps.newHost).toBe(en.lobby.newHost);
    expect(fr.race.stamps.newHost).toBe(fr.lobby.newHost);
  });

  it("the stamp's line in words, as it reads", () => {
    expect(stampText({ kind: "new-host", errors: 0, name: "Bea" }, 0, en.race.stamps)).toBe(
      "NEW HOST: BEA",
    );
  });
});
