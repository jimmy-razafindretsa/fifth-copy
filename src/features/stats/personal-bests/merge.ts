import type { MergeStep } from "@/features/identity";

/**
 * Guest merge of personal bests (ADR 0009, #999 C41): the guest's bests move to the account; where both
 * hold the same key (language, text type, length) the faster one stays (`isPersonalBest`'s strict
 * order: a tie keeps the account's). One INSERT .. ON CONFLICT, then the guest rows go. Returns the
 * guest rows carried over.
 */
export const personalBestMergeStep: MergeStep = {
  model: "PersonalBest",
  run: async (tx, guestId, accountId) => {
    await tx.$executeRaw`
      INSERT INTO "PersonalBest" ("userId", "language", "textType", "length", "cleanWpm", "accuracy", "raceId", "achievedAt")
      SELECT ${accountId}, "language", "textType", "length", "cleanWpm", "accuracy", "raceId", "achievedAt"
      FROM "PersonalBest" WHERE "userId" = ${guestId}
      ON CONFLICT ("userId", "language", "textType", "length") DO UPDATE SET
        "cleanWpm" = EXCLUDED."cleanWpm", "accuracy" = EXCLUDED."accuracy",
        "raceId" = EXCLUDED."raceId", "achievedAt" = EXCLUDED."achievedAt"
      WHERE "PersonalBest"."cleanWpm" < EXCLUDED."cleanWpm"`;
    return (await tx.personalBest.deleteMany({ where: { userId: guestId } })).count;
  },
};
