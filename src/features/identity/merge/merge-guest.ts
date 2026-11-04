import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { MODEL_NAMES } from "@/server/db-models";
import { logger } from "@/server/logger";
import { mergeSteps, modelsWithoutStep, type MergeContext } from "./registry";
import { MergeGuestError } from "./steps";

// The guest merge transaction (ADR 0009, #56): everything the guest owns moves to the account in
// one transaction, then the guest User row is deleted. Callers (sign-up #39, sign-in #40, OAuth
// #50) pass a guest id proven by the signed fc_guest cookie and the account the request just
// authenticated: this function trusts neither id beyond the checks below.

/** Rows moved or merged per Prisma model (`User`: the avatar moved). The guest is always deleted. */
export type MergeCounts = Record<string, number>;

const userId = z.string().min(1).max(64);

type Locked = { id: string; isGuest: boolean };

export async function mergeGuestInto(guestId: string, accountId: string): Promise<MergeCounts> {
  const ids = z.tuple([userId, userId]).safeParse([guestId, accountId]);
  if (!ids.success) throw new MergeGuestError("Invalid user id");
  if (guestId === accountId) throw new MergeGuestError("Cannot merge a user into itself");
  // Fail closed: a model with no step would lose the guest's rows to the cascade.
  const missing = modelsWithoutStep(MODEL_NAMES);
  if (missing.length > 0) {
    throw new MergeGuestError(`No merge step registered for: ${missing.join(", ")}`);
  }

  const afterCommit: Array<() => Promise<void>> = [];
  const onRollback: Array<() => Promise<void>> = [];
  const ctx: MergeContext = {
    afterCommit: (fn) => void afterCommit.push(fn),
    onRollback: (fn) => void onRollback.push(fn),
  };

  let counts: MergeCounts;
  try {
    counts = await db.$transaction(async (tx) => {
      // Lock both rows (in id order) so a concurrent merge, sign-up or deletion waits for us.
      const rows = await tx.$queryRaw<Locked[]>`
        SELECT "id", "isGuest" FROM "User" WHERE "id" IN (${guestId}, ${accountId})
        ORDER BY "id" FOR UPDATE`;
      const guest = rows.find((r) => r.id === guestId);
      const account = rows.find((r) => r.id === accountId);
      if (!guest || !account) throw new MergeGuestError("Unknown user");
      if (!guest.isGuest) throw new MergeGuestError("Source is not a guest");
      if (account.isGuest) throw new MergeGuestError("Target is not an account");

      const result: MergeCounts = {};
      for (const step of mergeSteps()) {
        const n = await step.run(tx, guestId, accountId, ctx);
        result[step.model] = (result[step.model] ?? 0) + n;
      }
      await tx.user.delete({ where: { id: guestId } });
      return result;
    });
  } catch (error) {
    for (const fn of onRollback) await settle(fn, "rollback");
    throw error;
  }
  for (const fn of afterCommit) await settle(fn, "afterCommit");
  return counts;
}

async function settle(fn: () => Promise<void>, phase: string) {
  try {
    await fn();
  } catch (error) {
    logger.warn("guest merge cleanup failed", {
      phase,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
