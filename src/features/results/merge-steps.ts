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
