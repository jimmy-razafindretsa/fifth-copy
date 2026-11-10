/**
 * The personal stats card's view model (#864, #302, bible 14.4 "Personal stats card", spec 11.3): the
 * viewer's own figures of this race, read from their stored `RaceResult` (ADR 0008, 0009), never
 * recomputed (ADR 0007). The WPM is the clean WPM (ADR 0016). The bonuses are the desk's `bonusLog`
 * grouped by kind: only the counts leave the query, never the log. Extension point: the WPM graph, the
 * errors by key, the tip and the personal-best flag (#321) are further fields here and further sections
 * of the card.
 */
import { bonusKindSchema, type BonusKind } from "@fifth-copy/protocol";
import { z } from "zod";
import type { ReportStatus } from "./report-status";

/** The three catch-up cards in the catalogue's order (spec 10), the order the card lists them in. */
export const BONUS_KINDS: readonly BonusKind[] = bonusKindSchema.options;

export type { BonusKind };

/** One kind and how many times: plays sent, or hits received. */
export type BonusTally = { kind: BonusKind; count: number };

export type BonusTallies = { sent: BonusTally[]; received: BonusTally[] };

export type PersonalStats = {
  desk: number;
  place: number;
  /** Clean WPM (`RaceResult.cleanWpm`, ADR 0016). */
  wpm: number;
  /** 0..1 */
  accuracy: number;
  status: ReportStatus;
  /** Stored but under review (ARCHITECTURE 7.7): the card keeps its figures under `UNDER REVIEW`. */
  suspicious: boolean;
  bonuses: BonusTallies;
};

/** One stored log entry (`RaceResult.bonusLog`, the engine's `BonusLogEntry`; `t` ms since GO). */
export type StoredBonusEntry = { t: number; kind: BonusKind; from: number; to: number };

const entrySchema = z.object({
  t: z.number(),
  kind: bonusKindSchema,
  from: z.number().int(),
  to: z.number().int(),
});

/** The stored Json column as entries: anything malformed (or a kind no longer in the catalogue) drops. */
export function parseBonusLog(json: unknown): StoredBonusEntry[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((e) => {
    const parsed = entrySchema.safeParse(e);
    return parsed.success ? [parsed.data] : [];
  });
}

const tallied = (counts: Map<BonusKind, number>): BonusTally[] =>
  BONUS_KINDS.flatMap((kind) => {
    const count = counts.get(kind) ?? 0;
    return count > 0 ? [{ kind, count }] : [];
  });

/**
 * `desk`'s bonuses, as the engine's ledger counts them (`record` in @fifth-copy/engine): sent = its
 * plays (entries whose `from` is the desk, one per play: a smoke break on three desks is three entries
 * of one `t`), received = hits from another desk (entries whose `to` is the desk; an exemption on
 * oneself is sent, not received).
 */
export function tallyBonuses(desk: number, log: readonly StoredBonusEntry[]): BonusTallies {
  const plays = new Set<string>();
  const sent = new Map<BonusKind, number>();
  const received = new Map<BonusKind, number>();
  for (const e of log) {
    if (e.from === desk) {
      const play = `${e.t}:${e.kind}`;
      if (!plays.has(play)) {
        plays.add(play);
        sent.set(e.kind, (sent.get(e.kind) ?? 0) + 1);
      }
    } else if (e.to === desk) {
      received.set(e.kind, (received.get(e.kind) ?? 0) + 1);
    }
  }
  return { sent: tallied(sent), received: tallied(received) };
}

/** The viewer's stored row as the card's model (the query selects these columns). */
export function personalFrom(row: {
  desk: number;
  place: number;
  cleanWpm: number;
  accuracy: number;
  status: ReportStatus;
  suspicious: boolean;
  bonusLog: unknown;
}): PersonalStats {
  return {
    desk: row.desk,
    place: row.place,
    wpm: row.cleanWpm,
    accuracy: row.accuracy,
    status: row.status,
    suspicious: row.suspicious,
    bonuses: tallyBonuses(row.desk, parseBonusLog(row.bonusLog)),
  };
}
