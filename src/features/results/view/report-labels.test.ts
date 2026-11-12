import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import type { DawnReport } from "./dawn-report";
import { dawnReportFixtures } from "./dawn-report-fixtures";
import { reportActions } from "./report-labels";

// The fixtures read identity's barrel (outfitForDesk), server code that validates the env on import.
vi.mock("@/env", () => ({ env: {} }));

// Contract of #863 C1 (and #143 C4): the Dawn report's action row as one ordered list from one pure
// function. A member (the viewer has a desk) of a race whose lobby is open: `again` then `home`;
// everyone else: `home`; a guest member also gets `signup` to /sign-up; an account, a spectator and a
// visitor with no identity never do.
type Report = Extract<DawnReport, { kind: "report" }>;
const base = dawnReportFixtures.full;
const make = (lobbyOpen: boolean, viewerDesk: number | null, lobbyCode = "KGB-4821"): Report => ({
  ...base,
  race: { ...base.race, lobbyOpen, lobbyCode },
  viewerDesk,
});
const kinds = (report: Report, viewerIsGuest: boolean) =>
  reportActions(en.results, { ...report, viewerIsGuest }).map((a) => a.kind);

const AGAIN = { kind: "again", label: "RACE AGAIN", href: "/lobby/KGB-4821" };
const HOME = { kind: "home", label: "BACK TO THE FRONT DESK →", href: "/" };
const SIGNUP = {
  kind: "signup",
  label: "OPEN A FILE →",
  href: "/sign-up",
  prompt: en.results.actions.prompt,
};

describe("reportActions (#863 C1)", () => {
  it("an account member of an open lobby: RACE AGAIN, then the front desk; no prompt", () => {
    expect(reportActions(en.results, { ...make(true, 3), viewerIsGuest: false })).toEqual([
      AGAIN,
      HOME,
    ]);
  });

  it("a guest member of an open lobby: RACE AGAIN, the front desk, then the prompt", () => {
    expect(reportActions(en.results, { ...make(true, 3), viewerIsGuest: true })).toEqual([
      AGAIN,
      HOME,
      SIGNUP,
    ]);
  });

  it("a member of a closed lobby (or none on file): the front desk only, a guest also the prompt", () => {
    for (const report of [make(false, 3), make(true, 3, "")]) {
      expect(kinds(report, false)).toEqual(["home"]);
      expect(kinds(report, true)).toEqual(["home", "signup"]);
    }
    expect(reportActions(en.results, { ...make(false, 3), viewerIsGuest: false })).toEqual([HOME]);
  });

  it("a spectator (guest or account) and a visitor with no identity: the front desk only", () => {
    for (const lobbyOpen of [true, false]) {
      expect(kinds(make(lobbyOpen, null), true)).toEqual(["home"]);
      expect(kinds(make(lobbyOpen, null), false)).toEqual(["home"]);
    }
  });

  it("reads its words from the viewer's catalog", () => {
    const list = reportActions(fr.results, { ...make(true, 3), viewerIsGuest: true });
    expect(list.map((a) => a.label)).toEqual([
      "ENCORE UNE FOIS",
      "RETOUR À L'ACCUEIL →",
      "OUVRIR UN DOSSIER →",
    ]);
    expect(list[2]).toMatchObject({ href: "/sign-up", prompt: fr.results.actions.prompt });
  });

  it("the prompt's strings exist in en and fr with identical keys (#863 C4)", () => {
    expect(Object.keys(fr.results.actions).sort()).toEqual(Object.keys(en.results.actions).sort());
    for (const key of ["prompt", "signup"] as const) {
      expect(en.results.actions[key]).toBeTruthy();
      expect(fr.results.actions[key]).toBeTruthy();
    }
  });
});

describe("reportActions: the lobby's host without a desk (#876 C7)", () => {
  it("RACE AGAIN while the lobby is open, then the front desk; nothing more once it closed", () => {
    expect(
      reportActions(en.results, { ...make(true, null), viewerHosts: true, viewerIsGuest: false }),
    ).toEqual([AGAIN, HOME]);
    expect(kinds({ ...make(false, null), viewerHosts: true }, false)).toEqual(["home"]);
    expect(kinds({ ...make(true, null), viewerHosts: false }, false)).toEqual(["home"]);
  });
});
