import { registerMergeStep } from "@/features/identity";

// Guest merge (ADR 0009, #56): the guest's race rows move to the account. `RaceResult.name` keeps
// the name the desk raced under.
registerMergeStep({
  model: "RaceResult",
  run: async (tx, guestId, accountId) =>
    (await tx.raceResult.updateMany({ where: { userId: guestId }, data: { userId: accountId } }))
      .count,
});
registerMergeStep({
  model: "RaceKeystrokes",
  run: async (tx, guestId, accountId) =>
    (
      await tx.raceKeystrokes.updateMany({
        where: { userId: guestId },
        data: { userId: accountId },
      })
    ).count,
});

// Per-key daily stats (#312, ADR 0024): the guest's rows move to the account; where the account
// already holds the same key the four counts are added. One INSERT .. ON CONFLICT, then the guest
// rows go (the guest row would cascade them away anyway). Returns the guest rows carried over.
registerMergeStep({
  model: "CharStatDaily",
  run: async (tx, guestId, accountId) => {
    await tx.$executeRaw`
      INSERT INTO "CharStatDaily" ("userId", "day", "char", "layout", "hits", "errors", "timedHits", "totalMs")
      SELECT ${accountId}, "day", "char", "layout", "hits", "errors", "timedHits", "totalMs"
      FROM "CharStatDaily" WHERE "userId" = ${guestId}
      ON CONFLICT ("userId", "day", "char", "layout") DO UPDATE SET
        "hits" = "CharStatDaily"."hits" + EXCLUDED."hits",
        "errors" = "CharStatDaily"."errors" + EXCLUDED."errors",
        "timedHits" = "CharStatDaily"."timedHits" + EXCLUDED."timedHits",
        "totalMs" = "CharStatDaily"."totalMs" + EXCLUDED."totalMs"`;
    return (await tx.charStatDaily.deleteMany({ where: { userId: guestId } })).count;
  },
});
registerMergeStep({
  model: "BigramStatDaily",
  run: async (tx, guestId, accountId) => {
    await tx.$executeRaw`
      INSERT INTO "BigramStatDaily" ("userId", "day", "pair", "hits", "errors", "timedHits", "totalMs")
      SELECT ${accountId}, "day", "pair", "hits", "errors", "timedHits", "totalMs"
      FROM "BigramStatDaily" WHERE "userId" = ${guestId}
      ON CONFLICT ("userId", "day", "pair") DO UPDATE SET
        "hits" = "BigramStatDaily"."hits" + EXCLUDED."hits",
        "errors" = "BigramStatDaily"."errors" + EXCLUDED."errors",
        "timedHits" = "BigramStatDaily"."timedHits" + EXCLUDED."timedHits",
        "totalMs" = "BigramStatDaily"."totalMs" + EXCLUDED."totalMs"`;
    return (await tx.bigramStatDaily.deleteMany({ where: { userId: guestId } })).count;
  },
});
