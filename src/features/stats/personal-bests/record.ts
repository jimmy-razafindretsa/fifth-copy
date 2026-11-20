import "server-only";
import type { AfterSaveStep } from "@/features/results/server";
import { raceSettingsFacts } from "../race-facts";
import { bestKeyOf, isPersonalBest } from "./rule";

/**
 * The personal-best step of the results filing transaction (#999 C41, ADR 0016): for each counted,
 * unflagged human result of the chunk, `isPersonalBest` against the stored best of its key (language,
 * text type, length); a new best is written with one guarded upsert that only ever raises the stored
 * clean WPM, so two filings of the same typist racing at once keep the higher one. Idempotent: a
 * repeated chunk is never strictly better than itself. A race whose stored settings have no text type
 * records no best.
 */
export const recordPersonalBests: AfterSaveStep = async (tx, { race, results }) => {
  const facts = raceSettingsFacts(race.settings);
  if (!facts) return;
  const key = bestKeyOf({ ...race, textType: facts.textType });
  const candidates = results.filter((r) => isPersonalBest(r, null));
  if (candidates.length === 0) return;
  const stored = new Map(
    (
      await tx.personalBest.findMany({
        where: { userId: { in: candidates.map((r) => r.userId) }, ...key },
        select: { userId: true, cleanWpm: true },
      })
    ).map((b) => [b.userId, b]),
  );
  for (const r of candidates) {
    if (!isPersonalBest(r, stored.get(r.userId) ?? null)) continue;
    await tx.$executeRaw`
      INSERT INTO "PersonalBest" ("userId", "language", "textType", "length", "cleanWpm", "accuracy", "raceId", "achievedAt")
      VALUES (${r.userId}, ${key.language}::"RaceLanguage", ${key.textType}::"RaceTextType",
        ${key.length}::"RaceLength", ${r.cleanWpm}, ${r.accuracy}, ${race.id}, ${race.endedAt})
      ON CONFLICT ("userId", "language", "textType", "length") DO UPDATE SET
        "cleanWpm" = EXCLUDED."cleanWpm", "accuracy" = EXCLUDED."accuracy",
        "raceId" = EXCLUDED."raceId", "achievedAt" = EXCLUDED."achievedAt"
      WHERE "PersonalBest"."cleanWpm" < EXCLUDED."cleanWpm"`;
  }
};
