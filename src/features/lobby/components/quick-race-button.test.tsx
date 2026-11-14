import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { quickRace } from "../actions/quick-race";
import { makeQuickRaceAction, QuickRaceButtonView } from "./quick-race-button";

// QUICK RACE (card 489/497, #128 C4): runs the matchmaking action, labels from the catalog, bible 7.1 variants.
vi.mock("../actions/quick-race", () => ({ quickRace: vi.fn() }));

const labels = en.landing.quick;
const errors = en.landing.errors;

// braces: a returned mock would be run as a teardown by vitest
beforeEach(() => {
  vi.mocked(quickRace).mockReset();
});

describe("quick race action (#128 C4)", () => {
  it.each([true, false])("navigates to the room quickRace chose (joined: %s)", async (joined) => {
    vi.mocked(quickRace).mockResolvedValue({ ok: true, code: "KGB-4821" as never, joined });
    const navigate = vi.fn();
    expect(await makeQuickRaceAction(navigate)()).toEqual({ error: null });
    expect(quickRace).toHaveBeenCalledExactlyOnceWith();
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/lobby/KGB-4821");
  });

  it.each([
    ["race-server-unavailable", "race-server-unavailable"],
    ["rate-limited", "generic"],
    ["invalid-settings", "generic"],
  ] as const)("turns %s into the %s error line, without navigating", async (error, line) => {
    vi.mocked(quickRace).mockResolvedValue({ ok: false, error });
    const navigate = vi.fn();
    expect(await makeQuickRaceAction(navigate)()).toEqual({ error: line });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("turns a thrown action into the generic line, without navigating", async () => {
    vi.mocked(quickRace).mockRejectedValue(new Error("boom"));
    const navigate = vi.fn();
    expect(await makeQuickRaceAction(navigate)()).toEqual({ error: "generic" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a press after an error runs again (retry)", async () => {
    vi.mocked(quickRace).mockResolvedValueOnce({ ok: false, error: "race-server-unavailable" });
    vi.mocked(quickRace).mockResolvedValueOnce({
      ok: true,
      code: "KGB-4821" as never,
      joined: false,
    });
    const navigate = vi.fn();
    const action = makeQuickRaceAction(navigate);
    expect(await action()).toEqual({ error: "race-server-unavailable" });
    expect(await action()).toEqual({ error: null });
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/lobby/KGB-4821");
  });
});

describe("QuickRaceButtonView", () => {
  const view = (props: Partial<Parameters<typeof QuickRaceButtonView>[0]>) =>
    renderToStaticMarkup(
      <QuickRaceButtonView
        pending={false}
        error={null}
        labels={labels}
        errors={errors}
        {...props}
      />,
    );

  it("renders the stamp button with the catalog label", () => {
    const html = view({});
    expect(html).toContain(">QUICK RACE<");
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('role="alert"');
  });

  it("reads FINDING A ROOM…, disabled and busy, while the room opens", () => {
    const html = view({ pending: true });
    expect(html).toContain("FINDING A ROOM…");
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
  });

  it("after an error the button is enabled again, the error line under it", () => {
    const html = view({ error: "generic" });
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("aria-busy");
    expect(html).toContain(">QUICK RACE<");
    expect(html).toContain(errors.generic);
  });

  it("shows the docket error line and the inverted variant", () => {
    const html = view({ error: "race-server-unavailable", variant: "inverted" });
    expect(html).toContain('role="alert"');
    expect(html).toContain(errors.unavailable);
    expect(html).toMatch(/class="[^"]*stampInverted/);
  });
});

describe("the landing's two QUICK RACE buttons (#128 C4)", () => {
  const source = (file: string) => readFileSync(path.resolve(__dirname, file), "utf8");

  it("hero and final call both render QuickRaceButton, whose action runs quickRace", () => {
    // #943: `/` composes the landing through LandingView (shared with /welcome)
    const page = source("../../../app/_components/landing-view.tsx");
    expect(page.match(/<QuickRaceButton\b/g)).toHaveLength(2);
    expect(page).toMatch(/primary=\{<QuickRaceButton\b/);
    expect(page).toMatch(/finalAction=\{<QuickRaceButton\b/);
    expect(source("./quick-race-button.tsx")).toMatch(/useActionState\(makeQuickRaceAction\(/);
  });

  it("PRACTISE VS BOTS stays in the hero's entries beside it (the bots fallback, R64)", () => {
    expect(source("../../../app/_components/landing-view.tsx")).toMatch(
      /entries=\{<LobbyEntries \/>\}/,
    );
    expect(source("./lobby-entries.tsx")).toMatch(/<PracticeButton\b/);
    expect(en.landing.entries.practise).toBe("PRACTISE VS BOTS");
  });
});
