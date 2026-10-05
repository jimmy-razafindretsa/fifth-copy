import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Member } from "@fifth-copy/protocol";
import { en } from "@/i18n/en";
import { deskLabel, fill, playersLabel } from "./lobby-labels";
import { LobbyLiveView } from "./lobby-live";
import { initialLobbyState, type LobbyState } from "./lobby-store";
import { PlayerList } from "./player-list";

// Contract of card 107, C6: every state renders, every string from the catalog (C6 greps `src`).
vi.mock("../actions/mint-race-token", () => ({ mintRaceToken: vi.fn() }));

const labels = en.lobby;
const errors = en.landing.errors;
const CODE = "KGB-4821";

const member = (desk: number, isHost = false): Member => ({ desk, name: `Clerk-${desk}`, isHost });
const live = (members: Member[], you = 1): LobbyState => ({
  phase: "live",
  error: null,
  you,
  members,
});
const view = (state: LobbyState) =>
  renderToStaticMarkup(<LobbyLiveView code={CODE} state={state} labels={labels} errors={errors} />);
const rows = (html: string) => html.match(/<li[ >]/g)?.length ?? 0;

describe("labels", () => {
  it("fills templates from the catalog", () => {
    expect(fill(labels.typistsValue, { n: 2, max: 30 })).toBe("2 / 30");
    expect(deskLabel(labels, 5)).toBe("DESK 05");
    expect(deskLabel(labels, 30)).toBe("DESK 30");
    expect(playersLabel(labels, 1)).toBe(fill(labels.players.one, { n: 1 }));
    expect(playersLabel(labels, 2)).toBe(fill(labels.players.other, { n: 2 }));
  });
});

describe("LobbyLiveView states", () => {
  it("loading: skeleton rows in an aria-busy list, the docket without a count", () => {
    const html = view(initialLobbyState);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(labels.loading);
    expect(html).toContain(`aria-label="${labels.listName}"`);
    expect(rows(html)).toBe(3);
    expect(html).not.toContain(labels.host);
    expect(html).toContain(`aria-label="${labels.codeName}"`);
    expect(html).toContain(CODE);
    expect(html).toContain(fill(labels.typistsValue, { n: "—", max: 30 }));
    expect(html).not.toContain('role="alert"');
  });

  it("populated with one row: HOST and YOU on the viewer's row, the count announced", () => {
    const html = view(live([member(1, true)]));
    expect(html).not.toContain("aria-busy");
    expect(rows(html)).toBe(1);
    expect(html).toContain(deskLabel(labels, 1));
    expect(html).toContain(`>${labels.host}<`);
    expect(html).toContain(`>${labels.you}<`);
    expect(html).toContain(fill(labels.typistsValue, { n: 1, max: 30 }));
    expect(html).toMatch(new RegExp(`aria-live="polite"[^>]*>${playersLabel(labels, 1)}<`));
  });

  it("populated with two rows: YOU follows the viewer's desk, HOST the host", () => {
    const html = view(live([member(1, true), member(2)], 2));
    expect(rows(html)).toBe(2);
    const [first, second] = html.split("<li").slice(1);
    expect(first).toContain(labels.host);
    expect(first).not.toContain(`>${labels.you}<`);
    expect(second).toContain(`>${labels.you}<`);
    expect(second).not.toContain(labels.host);
    expect(html).toContain(playersLabel(labels, 2));
    expect(html).toContain(fill(labels.typistsValue, { n: 2, max: 30 }));
  });

  it("populated with thirty rows, desks 01 to 30, in a focusable list", () => {
    const members = Array.from({ length: 30 }, (_, i) => member(i + 1, i === 0));
    const html = view(live(members));
    expect(rows(html)).toBe(30);
    expect(html).toContain(deskLabel(labels, 30));
    expect(html).toContain('tabindex="0"');
    expect(html).toContain(fill(labels.typistsValue, { n: 30, max: 30 }));
  });

  it.each([
    ["closed", errors.closed],
    ["not-found", errors.notFound],
    ["generic", errors.generic],
  ] as const)("error %s: an InlineError line, no list", (error, message) => {
    const html = view({ ...initialLobbyState, phase: "error", error });
    expect(html).toContain('role="alert"');
    expect(html).toContain(errors.prefix);
    expect(html).toContain(message);
    expect(rows(html)).toBe(0);
    expect(html).not.toContain("aria-busy");
  });

  it("reconnecting: the notice row above the last known list", () => {
    const html = view({ ...live([member(1, true), member(2)]), phase: "reconnecting" });
    expect(html).toContain(labels.reconnecting);
    expect(html).toMatch(/role="status"/);
    expect(html.indexOf(labels.reconnecting)).toBeLessThan(html.indexOf("<ul"));
    expect(rows(html)).toBe(2);
  });
});

describe("PlayerList slots", () => {
  it("renders leading before the name and tags after the badges", () => {
    const html = renderToStaticMarkup(
      <PlayerList
        members={[member(3, true)]}
        you={3}
        labels={labels}
        leading={() => <i>avatar</i>}
        tags={() => <b>extra</b>}
      />,
    );
    const order = ["<i>avatar</i>", "Clerk-3", labels.host, labels.you, "<b>extra</b>"].map((s) =>
      html.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
