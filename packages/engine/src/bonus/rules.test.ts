import { describe, expect, it } from "vitest";
import { replayTrace } from "../anticheat/analyse";
import { applyKeystroke, BACKSPACE } from "../reducers/apply";
import { initialState, type PlayerState } from "../reducers/state";
import { mulberry32, pick, pickInt } from "../testing/rng";
import { EMPTY_OVERLAY, effectiveText, wordsOf } from "../text/overlay";
import type { BonusKind, EngineSettings, Keystroke, Rng, TextOverlay } from "../types";
import { EMPTY_LEDGER, MAX_LOG_ENTRIES, record } from "./ledger";
import {
  applyBonus,
  BLUR_MS,
  canHit,
  canPlay,
  COOLDOWN_MS,
  eligibleBonus,
  EXEMPT_WORDS,
  EXTRA_WORDS,
  rankPct,
  type BonusDesk,
  type BonusInput,
} from "./rules";

const SETTINGS: EngineSettings = { errorMode: "continue", backspace: true };
const BASE = "un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze";
const KINDS: BonusKind[] = ["extra-paperwork", "exemption", "smoke-break"];

/** The spec 10 rule, written out independently of the table. */
function expected(rank: number, n: number): BonusKind | null {
  if (n < 3 || rank === 1) return null;
  const pct = (rank - 1) / (n - 1);
  if (pct >= 0.75) return "smoke-break";
  if (pct >= 0.67) return "exemption";
  if (pct >= 0.5) return "extra-paperwork";
  return null;
}

// C1 (#190): eligibility by live rank percentile.
describe("eligibleBonus (C1)", () => {
  for (const n of [2, 3, 4, 10, 30]) {
    it(`N = ${n}: every rank`, () => {
      const got = Array.from({ length: n }, (_, i) => eligibleBonus(rankPct(i + 1, n), n));
      expect(got).toEqual(Array.from({ length: n }, (_, i) => expected(i + 1, n)));
      expect(got[0]).toBeNull();
    });
  }

  it.each([
    { n: 2, ranks: [null, null] },
    { n: 3, ranks: [null, "extra-paperwork", "smoke-break"] },
    { n: 4, ranks: [null, null, "extra-paperwork", "smoke-break"] },
  ])("N = $n is $ranks", ({ n, ranks }) => {
    expect(ranks.map((_, i) => eligibleBonus(rankPct(i + 1, n), n))).toEqual(ranks);
  });

  it("thresholds are inclusive", () => {
    expect(eligibleBonus(0.5, 3)).toBe("extra-paperwork");
    expect(eligibleBonus(0.67, 101)).toBe("exemption");
    expect(eligibleBonus(rankPct(68, 101), 101)).toBe("exemption");
    expect(eligibleBonus(0.75, 5)).toBe("smoke-break");
    expect(eligibleBonus(rankPct(4, 5), 5)).toBe("smoke-break");
    expect(eligibleBonus(0.4999, 30)).toBeNull();
  });

  it("N = 30 deals each kind somewhere", () => {
    const kinds = new Set(
      Array.from({ length: 30 }, (_, i) => eligibleBonus(rankPct(i + 1, 30), 30)),
    );
    expect(kinds).toEqual(new Set([null, ...KINDS]));
  });
});

const typed = (cursor: number, text = BASE): PlayerState =>
  replayTrace(
    [...text.slice(0, cursor)].map((key, i) => ({ t: i * 100, key })),
    text,
    SETTINGS,
  );

const deskOf = (desk: number, cursor: number, more: Partial<BonusDesk> = {}): BonusDesk => ({
  desk,
  state: typed(cursor),
  reach: cursor,
  overlay: EMPTY_OVERLAY,
  lastHitBy: null,
  ...more,
});

const inputOf = (from: number, ranks: BonusDesk[], rng: Rng = mulberry32(1)): BonusInput => ({
  from,
  ranks,
  base: BASE,
  now: 20_000,
  rng,
  maxOverlayWords: 500,
});

describe("applyBonus effects", () => {
  const ranks = [deskOf(3, 40), deskOf(1, 30), deskOf(2, 10), deskOf(4, 2)];

  it("extra-paperwork appends 5 base words to the leader only", () => {
    const out = applyBonus("extra-paperwork", inputOf(4, ranks))!;
    expect(out.event).toEqual({ t: 20_000, kind: "extra-paperwork", from: 4, to: [3] });
    expect(out.hits).toHaveLength(1);
    const extra = out.hits[0]!.overlay!.extra;
    expect(extra).toHaveLength(EXTRA_WORDS);
    for (const w of extra) expect(wordsOf(BASE)).toContain(w);
  });

  it("extra-paperwork skips a finished leader, and is refused with no typing desk ahead", () => {
    const done = { ...typed(BASE.length) };
    expect(done.status).toBe("finished");
    const out = applyBonus(
      "extra-paperwork",
      inputOf(4, [{ ...ranks[0]!, state: done }, ...ranks.slice(1)]),
    )!;
    expect(out.event.to).toEqual([1]);
    expect(applyBonus("extra-paperwork", inputOf(3, ranks))).toBeNull();
  });

  it("extra-paperwork is refused when the leader's extra would pass the overlay bound", () => {
    const full: TextOverlay = { extra: Array(496).fill("un") as string[], removed: [] };
    const capped = [{ ...ranks[0]!, overlay: full }, ...ranks.slice(1)];
    expect(applyBonus("extra-paperwork", inputOf(4, capped))).toBeNull();
  });

  it("exemption removes the next 5 untyped base words of the sender, never the cursor word", () => {
    // desk 2 at cursor 10: "un deux tr|ois" -> cursor word "trois" (index 2).
    const out = applyBonus("exemption", inputOf(2, ranks))!;
    expect(out.event.to).toEqual([2]);
    expect(out.hits[0]!.overlay!.removed).toEqual([3, 4, 5, 6, 7]);
    expect(out.hits[0]!.state).toBeNull();
  });

  it("exemption keeps the word after a reached space and the word under the high-water mark", () => {
    const text = "un deux trois quatre";
    const state = typed(7, text); // "un deux" typed, cursor on the space
    const run = (reach: number) =>
      applyBonus("exemption", {
        ...inputOf(2, [
          deskOf(1, 1),
          { desk: 2, state, reach, overlay: EMPTY_OVERLAY, lastHitBy: null },
        ]),
        base: text,
      });
    expect(run(7)!.hits[0]!.overlay!.removed).toEqual([3]);
    // Typed into "quatre" once, then backspaced to 7: "quatre" stays.
    expect(run(15)).toBeNull();
    expect(run(7)!.hits[0]!.state).toBeNull();
  });

  it("exemption with no untyped base word left is refused", () => {
    const last = BASE.length - 3;
    expect(applyBonus("exemption", inputOf(1, [deskOf(1, last)]))).toBeNull();
  });

  it("smoke-break blurs every typing desk ahead for 5 s, nothing else", () => {
    const out = applyBonus("smoke-break", inputOf(4, ranks))!;
    expect(out.event.to).toEqual([3, 1, 2]);
    for (const hit of out.hits) {
      expect(hit).toEqual({
        desk: hit.desk,
        overlay: null,
        state: null,
        blurUntil: 20_000 + BLUR_MS,
      });
    }
  });

  it("immune targets are dropped; all immune -> refused", () => {
    const immune = ranks.map((d) =>
      d.desk === 1 ? { ...d, lastHitBy: "smoke-break" as const } : d,
    );
    expect(applyBonus("smoke-break", inputOf(4, immune))!.event.to).toEqual([3, 2]);
    const allImmune = ranks.map((d) => ({ ...d, lastHitBy: "smoke-break" as const }));
    expect(applyBonus("smoke-break", inputOf(4, allImmune))).toBeNull();
    // Another kind still lands.
    expect(applyBonus("extra-paperwork", inputOf(4, allImmune))!.event.to).toEqual([3]);
  });
});

/** Random continue-mode keystrokes over `text`: mostly right, some wrong, some backspaces. */
function randomTrace(rng: Rng, text: string, keys: number): Keystroke[] {
  const out: Keystroke[] = [];
  let state = initialState();
  for (let i = 0; i < keys && state.status === "typing"; i++) {
    const r = rng();
    const key = r < 0.08 ? BACKSPACE : r < 0.15 ? "z" : (text[state.cursor] ?? "a");
    const k = { t: i * 50, key };
    out.push(k);
    state = applyKeystroke(state, k, text, SETTINGS);
  }
  return out;
}

// C2 (#190): seeded properties over random overlay applications.
describe("overlay properties (C2)", () => {
  it("500 random applications: base untouched, word count, replay keeps the cursor's character", () => {
    const rng = mulberry32(190);
    for (let run = 0; run < 500; run++) {
      const base = Array.from({ length: 6 + pickInt(rng, 20) }, () =>
        "abcdefgh".slice(0, 1 + pickInt(rng, 6)),
      ).join(" ");
      const frozenBase = `${base}`;
      const baseWords = wordsOf(base).length;
      const desks = [1, 2, 3, 4].map((desk) => {
        // A prior overlay of earlier plays: some extras, some removed base words.
        const overlay: TextOverlay = {
          extra: Array.from({ length: pickInt(rng, 3) * 5 }, () =>
            "xyz".slice(0, 1 + pickInt(rng, 3)),
          ),
          removed: [
            ...new Set(Array.from({ length: pickInt(rng, 4) }, () => pickInt(rng, baseWords))),
          ],
        };
        const text = effectiveText(base, overlay);
        const trace = randomTrace(rng, text, pickInt(rng, text.length));
        let reach = 0;
        let state = initialState();
        for (const k of trace) {
          state = applyKeystroke(state, k, text, SETTINGS);
          reach = Math.max(reach, state.cursor);
        }
        return { desk, trace, state, reach, overlay };
      });
      desks.sort((a, b) => b.state.cursor - a.state.cursor);
      const kind = pick(rng, KINDS);
      const from = desks[desks.length - 1]!.desk;
      const ranks: BonusDesk[] = desks.map((d) => Object.freeze({ ...d, lastHitBy: null }));
      const out = applyBonus(kind, {
        from,
        ranks,
        base,
        now: 10_000,
        rng,
        maxOverlayWords: 500,
      });
      expect(base).toBe(frozenBase);
      for (const hit of out?.hits ?? []) {
        if (!hit.overlay) continue;
        const d = desks.find((x) => x.desk === hit.desk)!;
        const before = effectiveText(base, d.overlay);
        const after = effectiveText(base, hit.overlay);
        const removed = new Set(hit.overlay.removed).size;
        expect(wordsOf(after)).toHaveLength(
          wordsOf(base).length - removed + hit.overlay.extra.length,
        );
        // Everything typed so far is the same characters in the new text.
        expect(after.slice(0, d.state.cursor)).toBe(before.slice(0, d.state.cursor));
        const replayed = replayTrace(d.trace, after, SETTINGS);
        expect(replayed).toEqual(d.state);
        if (d.state.cursor < after.length)
          expect(after[d.state.cursor]).toBe(before[d.state.cursor]);
      }
    }
  });

  it("immunity never lets the same kind hit the same desk twice in a row", () => {
    const rng = mulberry32(14);
    const lastHit = new Map<number, BonusKind | null>([1, 2, 3, 4, 5].map((d) => [d, null]));
    let hits = 0;
    for (let run = 0; run < 500; run++) {
      const order = [1, 2, 3, 4, 5].sort(() => rng() - 0.5);
      const ranks = order.map((desk, i) =>
        deskOf(desk, 50 - i * 10, { lastHitBy: lastHit.get(desk) ?? null }),
      );
      const kind = pick(rng, KINDS);
      const out = applyBonus(kind, inputOf(order[4]!, ranks, rng));
      for (const hit of out?.hits ?? []) {
        if (!canHit(kind, null) || kind === "exemption") continue;
        expect(lastHit.get(hit.desk)).not.toBe(kind);
        lastHit.set(hit.desk, kind);
        hits += 1;
      }
    }
    expect(hits).toBeGreaterThan(100);
  });

  it("cooldown refuses a second play within 15 s and accepts at 15 s", () => {
    const rng = mulberry32(15);
    expect(canPlay(null, 0)).toBe(true);
    for (let run = 0; run < 500; run++) {
      const at = pickInt(rng, 600_000);
      expect(canPlay(at, at + pickInt(rng, COOLDOWN_MS))).toBe(false);
      expect(canPlay(at, at + COOLDOWN_MS)).toBe(true);
      expect(canPlay(at, at + COOLDOWN_MS + pickInt(rng, 60_000))).toBe(true);
    }
  });
});

describe("ledger", () => {
  it("counts sent and received, one log entry per (from, to) pair", () => {
    const event = { t: 1_000, kind: "smoke-break" as const, from: 4, to: [3, 1, 2] };
    const sender = record(EMPTY_LEDGER, 4, event);
    expect(sender).toMatchObject({ sent: 1, received: 0 });
    expect(sender.log).toHaveLength(3);
    expect(record(EMPTY_LEDGER, 1, event)).toEqual({
      sent: 0,
      received: 1,
      log: [{ t: 1_000, kind: "smoke-break", from: 4, to: 1 }],
    });
    expect(record(EMPTY_LEDGER, 9, event)).toBe(EMPTY_LEDGER);
  });

  it("an exemption on oneself is sent once, not received", () => {
    const event = { t: 5, kind: "exemption" as const, from: 2, to: [2] };
    expect(record(EMPTY_LEDGER, 2, event)).toEqual({
      sent: 1,
      received: 0,
      log: [{ t: 5, kind: "exemption", from: 2, to: 2 }],
    });
  });

  it("the log stops at MAX_LOG_ENTRIES, the counters do not", () => {
    let ledger = EMPTY_LEDGER;
    const event = { t: 1, kind: "smoke-break" as const, from: 7, to: [1] };
    for (let i = 0; i < MAX_LOG_ENTRIES + 10; i++) ledger = record(ledger, 1, event);
    expect(ledger.log).toHaveLength(MAX_LOG_ENTRIES);
    expect(ledger.received).toBe(MAX_LOG_ENTRIES + 10);
  });
});

it("EXEMPT_WORDS and EXTRA_WORDS are the spec's 5", () => {
  expect([EXEMPT_WORDS, EXTRA_WORDS]).toEqual([5, 5]);
});
