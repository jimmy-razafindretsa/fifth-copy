import type { MergeStep } from "@/features/identity";

/**
 * Guest merge of achievements (ADR 0009, #999 C35): the guest's medals move to the account. A medal both
 * hold stays once, with the earlier award time. One INSERT .. ON CONFLICT, then the guest rows go (the
 * guest row would cascade them away anyway). Returns the guest rows carried over.
 */
export const achievementMergeStep: MergeStep = {
  model: "Achievement",
  run: async (tx, guestId, accountId) => {
    await tx.$executeRaw`
      INSERT INTO "Achievement" ("userId", "achievementId", "awardedAt")
      SELECT ${accountId}, "achievementId", "awardedAt" FROM "Achievement" WHERE "userId" = ${guestId}
      ON CONFLICT ("userId", "achievementId") DO UPDATE SET
        "awardedAt" = LEAST("Achievement"."awardedAt", EXCLUDED."awardedAt")`;
    return (await tx.achievement.deleteMany({ where: { userId: guestId } })).count;
  },
};
