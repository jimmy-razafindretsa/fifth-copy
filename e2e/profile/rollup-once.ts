import { createPrismaClient } from "@/server/db-client";
import { rollupKeystrokes } from "@/features/stats/jobs/rollup-char-stats";

/**
 * One run of the per-key rollup of #314 (the worker's `stats.rollup` job) for one typist's traces, as
 * the worker would run it a minute later (#970 C3). Run by e2e/profile/profile.spec.ts as
 * `tsx --conditions=react-server e2e/profile/rollup-once.ts <userId>` against `DATABASE_URL`: the same
 * function the worker schedules, scoped to that typist so parallel specs never roll up each other's.
 */
const userId = process.argv[2];
if (!userId) throw new Error("usage: rollup-once.ts <userId>");
const db = createPrismaClient(process.env.DATABASE_URL!);
const lines: string[] = [];
const log = {
  info: (msg: string, fields?: object) => lines.push(`${msg} ${JSON.stringify(fields ?? {})}`),
  error: (msg: string, fields?: object) => lines.push(`${msg} ${JSON.stringify(fields ?? {})}`),
};
void rollupKeystrokes({ db, now: new Date(), log }, { only: { userId } })
  .then(() => process.stdout.write(`${lines.join("\n")}\n`))
  .finally(() => db.$disconnect());
