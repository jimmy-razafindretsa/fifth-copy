import type { db } from "@/server/db";

// The guest merge extension point (ADR 0009, #56). Every feature that stores rows owned by a User
// registers one step per model; mergeGuestInto runs them all in one transaction, then deletes the
// guest (whose remaining rows would cascade away). coverage.test.ts fails the build when a model
// related to User has no step, and mergeGuestInto refuses to run when one is missing at runtime.

/** The interactive transaction client a step writes through (Prisma's TransactionClient). */
export type MergeTx = Omit<
  typeof db,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

/** Side effects outside the database (files) hang off the transaction's outcome. */
export type MergeContext = {
  /** Runs once the transaction committed; failures are logged, never thrown. */
  afterCommit(fn: () => Promise<void>): void;
  /** Runs when the transaction rolled back, to undo what a step did outside the database. */
  onRollback(fn: () => Promise<void>): void;
};

export type MergeStep = {
  /** The Prisma model this step moves (a key of Prisma.ModelName). */
  model: string;
  /** Moves the guest's rows of `model` to the account; returns how many rows it moved or merged. */
  run(tx: MergeTx, guestId: string, accountId: string, ctx: MergeContext): Promise<number>;
};

/** The User row itself: merged by the identity steps, then deleted. */
export const MERGE_IGNORED_MODELS: readonly string[] = ["User"];

/**
 * Models with neither a `userId` field nor a relation to User: nothing of the guest lives there.
 * coverage.test.ts checks this list against the schema, so it cannot go stale.
 */
export const MODELS_WITHOUT_USER: readonly string[] = ["Race", "Text"];

const steps: MergeStep[] = [];

/** Adds a step; returns a function that removes it (tests). */
export function registerMergeStep(step: MergeStep): () => void {
  steps.push(step);
  return () => {
    const i = steps.indexOf(step);
    if (i >= 0) steps.splice(i, 1);
  };
}

/** The registered steps, in registration order. */
export function mergeSteps(): readonly MergeStep[] {
  return [...steps];
}

/** Models that must have a step but have none, among `modelNames` (Prisma.ModelName values). */
export function modelsWithoutStep(modelNames: readonly string[]): string[] {
  const covered = new Set(steps.map((s) => s.model));
  return modelNames.filter(
    (m) => !covered.has(m) && !MERGE_IGNORED_MODELS.includes(m) && !MODELS_WITHOUT_USER.includes(m),
  );
}
