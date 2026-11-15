import type { Member } from "@fifth-copy/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { waitingRoomView, type WaitingRoomInput } from "../view/waiting-room-view";
import { WaitingRoom } from "./waiting-room";

// #937 C3, C4, C6, C7 (bible 7.4 "Waiting room"): the waiting room's markup.

const member = (desk: number, name: string): Member => ({
  desk,
  name,
  isHost: desk === 1,
  isBot: false,
  color: desk % 12,
  marker: "circle",
  avatar: null,
});

const input = (n: number, over: Partial<WaitingRoomInput> = {}): WaitingRoomInput => ({
  code: "KGB-4821",
  settings: { language: "fr", textType: "sentences" },
  you: 2,
  members: Array.from({ length: n }, (_, i) => member(i + 1, `Typist ${i + 1}`)),
  pending: [2],
  raceIn: true,
  sceneSettled: false,
  ...over,
});

const render = (
  n: number,
  order: number[],
  props: Partial<Parameters<typeof WaitingRoom>[0]> = {},
) =>
  renderToStaticMarkup(
    <WaitingRoom
      labels={{ ...en.race.waiting, cards: en.race.sabotageTray.cards }}
      view={waitingRoomView(input(n), order)}
      {...props}
    />,
  );

describe("WaitingRoom (#937)", () => {
  it("C1/C5 the kicker, the heading and a busy status docket with its header and tag", () => {
    const html = render(2, [1]);
    expect(html).toContain("data-waiting-room");
    expect(html).toContain(">SUMMONS · ROOM KGB-4821<");
    expect(html).toContain(">LOADING.<");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(">MISSION ORDER<");
    expect(html).toContain(">FORM 7-D<");
  });

  it("C2 the rows: room, text, language, desk, ready", () => {
    const html = render(2, [1]);
    expect(html).toContain(">Real sentences<");
    expect(html).toContain(">French<");
    expect(html).toContain("data-desk");
    expect(html).toMatch(/data-ready[^>]*>01 \/ 02</);
  });

  it("C3 the steps carry their state, one current, and the bar its value", () => {
    const html = render(2, [1]);
    expect(html).toContain('data-step="papers" data-step-state="done"');
    expect(html).toContain('data-step="machines" data-step-state="current"');
    expect(html).toContain('data-step="major" data-step-state="todo"');
    expect(html.match(/data-step-state="current"/g)).toHaveLength(1);
    expect(html).toContain(">Oiling the machines…<");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="50"');
  });

  it("C4 arrivals in order, one list, no loop copy while they fit the band", () => {
    const html = render(3, [3, 1]);
    expect(html).toContain(">ARRIVALS<");
    expect(html.indexOf("Typist 3")).toBeLessThan(html.indexOf("Typist 1"));
    expect(html).toContain("desk 03");
    expect(html).not.toContain("data-rolling");
    expect(html).not.toContain("data-loop");
  });

  it("C4 more arrivals than the band shows: the rows roll, the copy is aria-hidden", () => {
    const html = render(6, [6, 5, 4, 3, 1]);
    expect(html).toContain("data-rolling");
    expect(html).toMatch(/<ul aria-hidden="true" data-loop/);
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
  });

  it("C6 the French page", () => {
    const html = renderToStaticMarkup(
      <WaitingRoom
        labels={{ ...fr.race.waiting, cards: fr.race.sabotageTray.cards }}
        view={waitingRoomView(input(2), [1])}
        tip="Tape juste."
      />,
    );
    for (const s of [
      "AVIS DE CONVOCATION · SALLE KGB-4821",
      "CHARGEMENT.",
      "ORDRE DE MISSION",
      "FORMULAIRE 7-D",
      "Vraies phrases",
      "Huilage des machines…",
      "ARRIVÉES",
      "bureau 01",
      "LE MAJOR DIT :",
    ])
      expect(html).toContain(s);
  });

  it("C7 a cut line shows the reconnecting notice row at the top of the docket", () => {
    const html = render(2, [1], { notice: en.race.notice.reconnecting });
    expect(html).toContain('data-notice="reconnecting"');
    expect(html).toContain(">LINE CUT · RECONNECTING<");
    expect(html.indexOf("data-notice")).toBeLessThan(html.indexOf(">MISSION ORDER<"));
    expect(render(2, [1])).not.toContain("data-notice");
  });

  it("no desk: no DESK row; no tip: no Major line", () => {
    const html = renderToStaticMarkup(
      <WaitingRoom
        labels={{ ...en.race.waiting, cards: en.race.sabotageTray.cards }}
        view={waitingRoomView(input(2, { you: null }), [])}
      />,
    );
    expect(html).not.toContain("data-desk");
    expect(html).not.toContain("data-major");
  });
});

describe("WaitingRoom briefing (#951)", () => {
  it("lists the rules and the three sabotage cards with their effects and unlocks", () => {
    const html = renderToStaticMarkup(
      <WaitingRoom
        labels={{ ...en.race.waiting, cards: en.race.sabotageTray.cards }}
        view={waitingRoomView(input(2), [1])}
      />,
    );
    expect(html).toContain("data-briefing");
    expect(html).toContain(">THE RULES<");
    for (const rule of en.race.waiting.briefing.rules) expect(html).toContain(rule);
    for (const id of ["extra-paperwork", "exemption", "smoke-break"] as const) {
      expect(html).toContain(`data-card="${id}"`);
      expect(html).toContain(en.race.sabotageTray.cards[id].name);
      expect(html).toContain(en.race.waiting.briefing.unlocks[id]);
    }
  });

  it("ships tips in both languages", () => {
    expect(en.race.didYouKnow.length).toBeGreaterThanOrEqual(8);
    expect(fr.race.didYouKnow.length).toBe(en.race.didYouKnow.length);
  });
});

describe("nextPercent (#951): a progressive bar", () => {
  it("catches up with the real percent, never goes back, creeps toward the next step, 100 when done", async () => {
    const { nextPercent } = await import("./waiting-room-live");
    let p = 0;
    for (let i = 0; i < 20; i++) p = nextPercent(p, 53, false);
    expect(p).toBeGreaterThanOrEqual(53);
    const before = p;
    for (let i = 0; i < 400; i++) p = nextPercent(p, 53, false);
    expect(p).toBeGreaterThan(before);
    expect(p).toBeLessThanOrEqual(72);
    expect(nextPercent(70, 40, false)).toBe(70);
    expect(nextPercent(90, 95, false)).toBeLessThanOrEqual(97);
    expect(nextPercent(30, 80, true)).toBe(100);
  });
});
