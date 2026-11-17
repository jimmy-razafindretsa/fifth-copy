import { renderToReadableStream, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import type { Preferences } from "../../schema";

vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));
const state = vi.hoisted(() => ({ locale: "en" as "en" | "fr" }));
vi.mock("@/i18n", async () => {
  const { en } = await import("@/i18n/en");
  const { fr } = await import("@/i18n/fr");
  return { getT: async () => (state.locale === "fr" ? fr : en) };
});

const { DailyGoal } = await import("./daily-goal");
const { SettingsDocket } = await import("./settings-screen");

// #968 C2: the settings docket's daily goal block (reference `Profil.dc.html` `OBJECTIF QUOTIDIEN`).

const action = async () => ({ ok: false as const, reason: "invalid" as const });
const PREFS: Preferences = {
  layout: null,
  theme: "SYSTEM",
  locale: "en",
  sound: false,
  machineSkin: "teleprinter",
  dailyGoalMin: 15,
};

async function html(node: React.ReactNode): Promise<string> {
  return new Response(await renderToReadableStream(node)).text();
}

const goal = (t: typeof en, value = 15, initialStatus?: "error") =>
  renderToString(
    <DailyGoal
      value={value}
      labels={t.settings.goal}
      status={t.settings.status}
      action={action}
      initialStatus={initialStatus}
    />,
  );

describe("#968 C2 the daily goal block", () => {
  it.each([
    [en, "DAILY GOAL", "15 MIN / DAY", "15 minutes a day", en.settings.goal.hint],
    [fr, "OBJECTIF QUOTIDIEN", "15 MIN / JOUR", "15 minutes par jour", fr.settings.goal.hint],
  ] as const)(
    "names the block, shows the value and the hint (%#)",
    (t, title, value, spoken, hint) => {
      const out = goal(t);
      expect(out).toMatch(new RegExp(`<h2 id="([^"]+)-title"[^>]*>${title}</h2>`));
      expect(out).toContain(`>${value}</span>`);
      expect(out).toContain(`aria-valuetext="${spoken}"`);
      expect(out).toContain(`>${hint}</p>`);
    },
  );

  it("the hints are the reference's sentences", () => {
    expect(fr.settings.goal.hint).toBe(
      "Sert au registre de présence. Le Major ne pardonne pas les absences, mais il les note poliment.",
    );
    expect(en.settings.goal.hint).toBe(
      "Used by the attendance register. The Major does not forgive absences, but he notes them politely.",
    );
  });

  it("is a native range from 5 to 60 in steps of 5, labelled by the section name and described by the hint", () => {
    const out = goal(en, 30);
    const input = out.match(/<input[^>]*>/)?.[0] ?? "";
    expect(input).toContain('type="range"');
    expect(input).toContain('min="5"');
    expect(input).toContain('max="60"');
    expect(input).toContain('step="5"');
    expect(input).toContain('value="30"');
    expect(input).toContain('aria-valuetext="30 minutes a day"');
    const titleId = out.match(/<h2 id="([^"]+)"/)?.[1];
    const hintId = out.match(/<p id="([^"]+)" class="[^"]*hint/)?.[1];
    expect(input).toContain(`aria-labelledby="${titleId}"`);
    expect(input).toContain(`aria-describedby="${hintId}"`);
    expect(out).toContain(">30 MIN / DAY</span>");
  });

  it("a refused save shows the screen's error row, linked to the range", () => {
    const out = goal(en, 15, "error");
    const errorId = out.match(/<p id="([^"]+)" role="alert"/)?.[1];
    expect(out).toContain("RETURNED ·");
    expect(out).toContain(en.settings.status.error);
    expect(out.match(/<input[^>]*>/)?.[0]).toContain(errorId);
  });

  it("44px tall in the settings CSS, red accent", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("./settings.module.css", import.meta.url), "utf8");
    const rule = css.match(/\.goalRange \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("min-height: 44px");
    expect(rule).toContain("accent-color: var(--color-primary)");
  });

  it("sits in the docket after MACHINE, before ACCOUNT, with the viewer's goal", async () => {
    state.locale = "fr";
    const out = await html(
      <SettingsDocket viewer={null} preferences={{ ...PREFS, dailyGoalMin: 45 }} action={action} />,
    );
    const at = (s: string) => out.indexOf(s);
    expect(at(">OBJECTIF QUOTIDIEN</h2>")).toBeGreaterThan(at(">MACHINE</h2>"));
    expect(at(">OBJECTIF QUOTIDIEN</h2>")).toBeLessThan(at(fr.settings.sections.account));
    expect(out).toContain(">45 MIN / JOUR</span>");
  });
});
