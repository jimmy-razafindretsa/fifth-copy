import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type Member } from "@fifth-copy/protocol";
import {
  dropExpired,
  expireStamp,
  NEW_HOST_SHOW_MS,
  newHostStamp,
  pushStamp,
  STAMP_SHOW_MS,
  stampShowMs,
  type RaceStamp,
} from "./stamps";

// Contract of #868 C1 and C2 (the queue side): the NEW HOST notice is one more stamp kind in the #232
// queue. It holds the UI's slow duration x 5, and any stamp arriving while it shows replaces it at once.

const T = 1_767_225_600_000;
const member = (desk: number, name: string, isHost = false): Member => ({
  desk,
  name,
  isHost,
  isBot: false,
  color: (desk - 1) % 12,
  marker: (["circle", "square", "triangle", "diamond"] as const)[Math.floor((desk - 1) / 12) % 4]!,
});
const ROSTER = [member(1, "Sparrow-137", true), member(3, "Heron-411"), member(5, "Lynx-785")];
const newHost = (desk: number) => ({ v: PROTOCOL_VERSION, kind: "new-host", desk }) as const;

describe("#868 the NEW HOST notice in the stamp queue", () => {
  it("newHostStamp reads the desk's name from the roster; an unknown desk gives no notice", () => {
    expect(newHostStamp(newHost(3), ROSTER)).toEqual({
      kind: "new-host",
      other: 3,
      errors: 0,
      name: "Heron-411",
    });
    expect(newHostStamp(newHost(9), ROSTER)).toBeNull();
  });

  it("holds the UI's slow duration x 5 (--motion-duration-slow in tokens.css); the other kinds 1.4 s", () => {
    const css = readFileSync(join(process.cwd(), "docs/design/tokens.css"), "utf8");
    const slow = /--motion-duration-slow:\s*(\d+)ms/.exec(css);
    expect(slow, "--motion-duration-slow").not.toBeNull();
    expect(NEW_HOST_SHOW_MS).toBe(Number(slow![1]) * 5);
    expect(NEW_HOST_SHOW_MS).toBe(3_000);
    expect(stampShowMs("new-host")).toBe(NEW_HOST_SHOW_MS);
    for (const kind of ["overtake", "passed", "accepted", "returned"] as const)
      expect(stampShowMs(kind)).toBe(STAMP_SHOW_MS);
  });

  it("shows at once on an empty queue and stays until its own hold is over", () => {
    const q = pushStamp([], {
      id: 1,
      kind: "new-host",
      other: 3,
      errors: 0,
      name: "Heron-411",
      at: T,
    });
    expect(q).toEqual([
      { id: 1, kind: "new-host", other: 3, errors: 0, name: "Heron-411", at: T, shownAt: T },
    ]);
    expect(dropExpired(q, T + STAMP_SHOW_MS)).toBe(q);
    expect(dropExpired(q, T + NEW_HOST_SHOW_MS - 1)).toBe(q);
    expect(dropExpired(q, T + NEW_HOST_SHOW_MS)).toEqual([]);
    expect(expireStamp(q, 1, T + NEW_HOST_SHOW_MS)).toEqual([]);
  });

  it("an overtake or a finish stamp arriving while it shows replaces it at once", () => {
    const shown = pushStamp([], {
      id: 1,
      kind: "new-host",
      other: 3,
      errors: 0,
      name: "Heron-411",
      at: T,
    });
    for (const kind of ["overtake", "passed", "accepted", "returned"] as const) {
      const q = pushStamp(shown, { id: 2, kind, other: 3, errors: 0, at: T + 1_000 });
      expect(q).toHaveLength(1);
      expect(q[0]).toMatchObject({ id: 2, kind, shownAt: T + 1_000 });
    }
    // a later new host replaces it too and restarts the hold (bible 14.3, as in the lobby)
    const later = pushStamp(shown, {
      id: 2,
      kind: "new-host",
      other: 5,
      errors: 0,
      name: "Lynx-785",
      at: T + 1_000,
    });
    expect(later).toEqual([
      {
        id: 2,
        kind: "new-host",
        other: 5,
        errors: 0,
        name: "Lynx-785",
        at: T + 1_000,
        shownAt: T + 1_000,
      },
    ]);
  });

  it("arriving behind an overtake it waits its turn, then shows for its own hold", () => {
    const over: RaceStamp[] = [{ id: 1, kind: "overtake", other: 3, errors: 0, at: T, shownAt: T }];
    const q = pushStamp(over, {
      id: 2,
      kind: "new-host",
      other: 3,
      errors: 0,
      name: "Heron-411",
      at: T + 200,
    });
    expect(q.map((s) => [s.id, s.shownAt])).toEqual([
      [1, T],
      [2, T + STAMP_SHOW_MS],
    ]);
    const next = expireStamp(q, 1, T + STAMP_SHOW_MS);
    expect(next.map((s) => s.id)).toEqual([2]);
    expect(dropExpired(next, T + STAMP_SHOW_MS + NEW_HOST_SHOW_MS - 1)).toBe(next);
    expect(dropExpired(next, T + STAMP_SHOW_MS + NEW_HOST_SHOW_MS)).toEqual([]);
  });
});
