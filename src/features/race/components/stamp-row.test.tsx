import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { rotationFromSeed } from "@/components/ui";
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

  it("OVERTAKE +1: the red md stamp, the Russian tagged, hidden from assistive tech", () => {
    const out = html({ id: 7, kind: "overtake", errors: 0 });
    expect(out).toContain('data-stamps="overtake"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('data-stamp-tone="red"');
    expect(out).toContain('data-stamp-size="md"');
    expect(out).toContain('<span lang="ru">ОБГОН!</span> · OVERTAKE +1');
    expect(out).not.toContain("role=");
  });

  it("PASSED −1: the ink stamp (U+2212 minus)", () => {
    const out = html({ id: 8, kind: "passed", errors: 0 });
    expect(out).toContain('data-stamp-tone="ink"');
    expect(out).toContain('<span lang="ru">ОБОГНАЛИ</span> · PASSED −1');
  });

  it("French: one language besides the in-world Russian", () => {
    expect(html({ id: 1, kind: "overtake", errors: 0 }, fr.race.stamps)).toContain(
      '<span lang="ru">ОБГОН!</span> · DÉPASSEMENT +1',
    );
    expect(html({ id: 1, kind: "passed", errors: 0 }, fr.race.stamps)).toContain(
      '<span lang="ru">ОБОГНАЛИ</span> · DÉPASSÉ −1',
    );
  });

  it("the angle is seeded by the stamp's id: the same stamp, the same angle, at least 2 degrees off level", () => {
    for (const id of [1, 2, 3, 41]) {
      const angle = Number(
        /data-stamp-angle="([^"]+)"/.exec(html({ id, kind: "overtake", errors: 0 }))![1],
      );
      expect(angle).toBe(rotationFromSeed(id));
      expect(Math.abs(angle)).toBeGreaterThanOrEqual(2);
      expect(Math.abs(angle)).toBeLessThanOrEqual(6);
    }
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
    expect(stampText({ kind: "overtake", errors: 0 }, 52, en.race.stamps)).toBe(
      "ОБГОН! · OVERTAKE +1",
    );
  });
});
