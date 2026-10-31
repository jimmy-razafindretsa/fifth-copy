import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import type { RaceLostReason, RacePhase } from "../client/store";
import { hudLabelFixtures } from "../view/hud-labels";
import { RaceSeat } from "./race-seat";
import { RaceSeatLiveView } from "./race-seat-live";
import { COMPACT_QUERY, PHONE_QUERY } from "./seat-view";

// #561 C4 and C6 at unit level: the shell the server renders (before-start HUD, kicker, phones notice),
// every live state of the status slot, and the `race` catalogs (one language per block, the HUD copy of
// bible 2 / 7.4 / 7.4a / 7.11 that #560 specified in hudLabelFixtures). The live flow is e2e/race.
const decode = (html: string) =>
  html
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');
const seat = { lobbyId: "cmuvut8r2000106r7wf01vr30", code: "KGB-4821" };
const mint = async () => ({ ok: false as const, error: "closed" as const });
/** The route hands the machine its rows (#224, `machineRows`); any rows do here. */
const ROWS = [
  ["q", "w", "e"],
  ["a", "s", "d"],
];

describe("race catalogs (#561 C6)", () => {
  it.each([
    ["en", en.race, hudLabelFixtures.en],
    ["fr", fr.race, hudLabelFixtures.fr],
  ] as const)("%s: the HUD copy is the bible's (hudLabelFixtures)", (_, race, hud) => {
    expect(race.counters).toEqual(hud.nixie);
    expect(race.raceCard).toEqual(hud.raceCard);
    expect(race.sabotageTray).toEqual(hud.sabotageTray);
    expect(race.abandon).toEqual(hud.abandon);
    const { phones, ...notice } = race.notice;
    expect(notice).toEqual(hud.notice);
    expect(phones).toMatch(/\S/);
  });

  it("#214 C6: the countdown copy, the Major's word plus one language per catalog", () => {
    expect(en.race.countdown).toEqual({ major: "НАЧАЛИ", go: "GO" });
    expect(fr.race.countdown).toEqual({ major: "НАЧАЛИ", go: "PARTEZ" });
  });

  it("the phones notice and the error prefix read in one language each", () => {
    expect(en.race.notice.phones).toBe("PHONES WATCH FROM THE BACK OF THE ROOM");
    expect(fr.race.notice.phones).toBe("LES CELLULAIRES REGARDENT DU FOND DE LA SALLE");
    expect(en.race.errors.prefix).toBe(en.landing.errors.prefix);
    expect(fr.race.errors.prefix).toBe(fr.landing.errors.prefix);
  });
});

describe("the seat shell on the server (#561 C4)", () => {
  const html = decode(
    renderToStaticMarkup(<RaceSeat seat={seat} labels={en.race} mint={mint} rows={ROWS} />),
  );

  it("renders every HUD part in its before-start state, over the paper backdrop", () => {
    expect(html).toContain('data-backdrop="paper"');
    expect(html).toMatch(/<h1[^>]*>SEAT VIEW<\/h1>/);
    expect(html).toContain('role="group" aria-label="Text to type"');
    expect(html).toContain("data-sheet");
    expect(html).toMatch(/data-machine="true" data-skin="teleprinter"/);
    // the machine draws the rows the route chose, plus its space bar
    expect([...html.matchAll(/data-key="([^"]*)"/g)].map((m) => m[1])).toEqual([
      ...ROWS.flat(),
      " ",
    ]);
    expect(html).toContain('data-device="nixie"');
    expect(html).toContain("00 / 00");
    expect(html).toContain("data-race-card");
    expect(html).toContain("0 TYPISTS");
    expect(html).toMatch(/data-sabotage-tray="[^"]*" data-card="none"/);
    expect(html).toContain("NO CARD");
    expect(html).toMatch(
      /data-abandon="disabled"[\s\S]*<button[^>]*disabled=""[^>]*>ABANDON<\/button>/,
    );
  });

  it("starts connecting: the status slot holds the skeleton rows", () => {
    expect(html).toMatch(/<ul aria-busy="true" aria-label="Taking your seat…"/);
  });

  it("carries the phones notice for <= 480 px, and nothing secret", () => {
    expect(html).toContain("PHONES WATCH FROM THE BACK OF THE ROOM");
    expect(PHONE_QUERY).toBe("(max-width: 480px)");
    expect(html).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
  });

  it("French renders French only", () => {
    const frHtml = decode(
      renderToStaticMarkup(<RaceSeat seat={seat} labels={fr.race} mint={mint} rows={ROWS} />),
    );
    expect(frHtml).toMatch(/<h1[^>]*>VUE DE TA PLACE<\/h1>/);
    expect(frHtml).toContain("ABANDONNER");
    expect(frHtml).toContain("FICHE DE COURSE");
    for (const word of ["SEAT VIEW", "ABANDON<", "RACE CARD", "NO CARD", "PHONES"]) {
      expect(frHtml).not.toContain(word);
    }
  });
});

describe("the status slot, phase by phase (#561 C4)", () => {
  const labels = { loading: en.race.loading, notice: en.race.notice, errors: en.race.errors };
  const view = (phase: RacePhase, lost: RaceLostReason | null = null) =>
    decode(
      renderToStaticMarkup(
        <RaceSeatLiveView phase={phase} lost={lost} code="KGB-4821" labels={labels} />,
      ),
    );

  it("connecting: skeleton rows, busy, named, no gradient", () => {
    const html = view("connecting");
    expect(html).toMatch(/aria-busy="true"/);
    expect((html.match(/<li /g) ?? []).length).toBe(2);
    expect(html).not.toMatch(/gradient/);
  });

  it.each([
    ["waiting", "waiting-for-host", "WAITING FOR THE HOST"],
    ["reconnecting", "reconnecting", "LINE CUT · RECONNECTING"],
  ] as const)("%s: the notice row", (phase, kind, text) => {
    expect(view(phase)).toMatch(new RegExp(`role="status" data-notice="${kind}"[^>]*>${text}</p>`));
  });

  it.each([
    ["closed", "This race is closed."],
    ["no-room", "This room is no longer open."],
    ["in-progress", "This race started without you."],
    ["not-found", "This race is not on file."],
    ["bad-token", "Something jammed. Try again."],
    ["version", "Something jammed. Try again."],
    ["generic", "Something jammed. Try again."],
  ] as const)(
    "lost (%s): the 7.4 error line and the way back to the waiting room",
    (lost, text) => {
      const html = view("lost", lost);
      expect(html).toContain(`data-lost="${lost}"`);
      expect(html).toMatch(
        new RegExp(
          `<p role="alert"[^>]*><span[^>]*>RETURNED ·</span> ${text.replace(".", "\\.")}</p>`,
        ),
      );
      expect(html).toMatch(/<a href="\/lobby\/KGB-4821"[^>]*>BACK TO THE WAITING ROOM →<\/a>/);
    },
  );

  it.each(["countdown", "running", "ended"] as const)(
    "%s: the view itself renders nothing (the countdown is RaceSeatLive's, #214; #559, #240)",
    (phase) => {
      expect(view(phase)).toBe("");
    },
  );
});

describe("the race card on the seat (#564)", () => {
  it("server-renders full (compact follows the viewport after hydration) with no lanes and no hidden desks list", () => {
    const html = renderToStaticMarkup(
      <RaceSeat seat={seat} labels={en.race} mint={mint} rows={ROWS} />,
    );
    const card = /<section[^>]*data-race-card[^>]*>/.exec(html)![0];
    expect(card).not.toContain("data-compact");
    expect(html).not.toContain("data-lane");
    expect(html).not.toContain("data-desks");
  });

  it("is compact below 1280px (bible 7.4a: tablets and small laptops)", () => {
    expect(COMPACT_QUERY).toBe("(max-width: 1279px)");
  });
});
