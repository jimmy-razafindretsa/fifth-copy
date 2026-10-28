import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { rotationFromSeed } from "@/components/ui";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { StampRow } from "./stamp-row";

// #232 C2 at unit level: the markup of each stamp. The live stamps, the slam, reduced motion and the
// layout are e2e/race/overtake.spec.ts.
describe("StampRow (#232 C2)", () => {
  const html = (stamp: Parameters<typeof StampRow>[0]["stamp"], labels = en.race.stamps) =>
    renderToStaticMarkup(<StampRow stamp={stamp} labels={labels} />);

  it("renders nothing without a stamp", () => {
    expect(html(null)).toBe("");
  });

  it("OVERTAKE +1: the red md stamp, the Russian tagged, hidden from assistive tech", () => {
    const out = html({ id: 7, kind: "overtake" });
    expect(out).toContain('data-stamps="overtake"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('data-stamp-tone="red"');
    expect(out).toContain('data-stamp-size="md"');
    expect(out).toContain('<span lang="ru">ОБГОН!</span> · OVERTAKE +1');
    expect(out).not.toContain("role=");
  });

  it("PASSED −1: the ink stamp (U+2212 minus)", () => {
    const out = html({ id: 8, kind: "passed" });
    expect(out).toContain('data-stamp-tone="ink"');
    expect(out).toContain('<span lang="ru">ОБОГНАЛИ</span> · PASSED −1');
  });

  it("French: one language besides the in-world Russian", () => {
    expect(html({ id: 1, kind: "overtake" }, fr.race.stamps)).toContain(
      '<span lang="ru">ОБГОН!</span> · DÉPASSEMENT +1',
    );
    expect(html({ id: 1, kind: "passed" }, fr.race.stamps)).toContain(
      '<span lang="ru">ОБОГНАЛИ</span> · DÉPASSÉ −1',
    );
  });

  it("the angle is seeded by the stamp's id: the same stamp, the same angle, at least 2 degrees off level", () => {
    for (const id of [1, 2, 3, 41]) {
      const angle = Number(/data-stamp-angle="([^"]+)"/.exec(html({ id, kind: "overtake" }))![1]);
      expect(angle).toBe(rotationFromSeed(id));
      expect(Math.abs(angle)).toBeGreaterThanOrEqual(2);
      expect(Math.abs(angle)).toBeLessThanOrEqual(6);
    }
  });
});
