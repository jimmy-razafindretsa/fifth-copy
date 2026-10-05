import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { createLobby } from "../actions/create-lobby";
import { makeQuickRaceAction, QuickRaceButtonView } from "./quick-race-button";

// QUICK RACE (card 489/497): opens a PUBLIC room, labels from the catalog, bible 7.1 variants.
vi.mock("../actions/create-lobby", () => ({ createLobby: vi.fn() }));

const labels = en.landing.quick;
const errors = en.landing.errors;

// braces: a returned mock would be run as a teardown by vitest
beforeEach(() => {
  vi.mocked(createLobby).mockReset();
});

describe("quick race action", () => {
  it("creates a public lobby and navigates to it", async () => {
    vi.mocked(createLobby).mockResolvedValue({ ok: true, code: "KGB-4821" as never });
    const navigate = vi.fn();
    expect(await makeQuickRaceAction(navigate)()).toEqual({ error: null });
    expect(createLobby).toHaveBeenCalledWith({ type: "PUBLIC" });
    expect(navigate).toHaveBeenCalledWith("/lobby/KGB-4821");
  });

  it("turns a refusal into an error line, without navigating", async () => {
    vi.mocked(createLobby).mockResolvedValue({ ok: false, error: "race-server-unavailable" });
    const navigate = vi.fn();
    expect(await makeQuickRaceAction(navigate)()).toEqual({ error: "race-server-unavailable" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("turns a thrown action into the generic line, without navigating", async () => {
    vi.mocked(createLobby).mockRejectedValue(new Error("boom"));
    const navigate = vi.fn();
    expect(await makeQuickRaceAction(navigate)()).toEqual({ error: "generic" });
    expect(navigate).not.toHaveBeenCalled();
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

  it("shows the docket error line and the inverted variant", () => {
    const html = view({ error: "race-server-unavailable", variant: "inverted" });
    expect(html).toContain('role="alert"');
    expect(html).toContain(errors.unavailable);
    expect(html).toMatch(/class="[^"]*stampInverted/);
  });
});
