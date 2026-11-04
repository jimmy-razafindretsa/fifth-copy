import { registerMergeStep } from "@/features/identity";

// Guest merge (ADR 0009, #56): lobbies the guest hosts move to the account, so the host's
// lobby (and the races it links) survives the guest row's deletion.
registerMergeStep({
  model: "Lobby",
  run: async (tx, guestId, accountId) =>
    (await tx.lobby.updateMany({ where: { hostUserId: guestId }, data: { hostUserId: accountId } }))
      .count,
});
