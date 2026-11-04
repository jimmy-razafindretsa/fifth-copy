/**
 * Idempotent development seed. Runs via `npx prisma db seed` (and after `migrate dev`).
 * Always guarded: refuses to run against a non-local database.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createPrismaClient } from "../src/server/db-client";
import { importCorpus } from "../scripts/import-texts";
import { seedIdentity } from "./seed-identity";

execFileSync("scripts/db-guard.sh", { stdio: "inherit" });

async function main() {
  const db = createPrismaClient(process.env.DATABASE_URL!);
  try {
    // Add upserts here as models appear. Keep it idempotent.
    await seedIdentity(db);
    // The text corpus (#346): the same licence-checked import as scripts/import-texts.ts.
    const texts = await importCorpus(db);
    console.log(`seed: texts ${texts.total} passages, ${texts.created} new`);
    console.log("seed: ok");
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error("seed: failed", err instanceof Error ? err.message : err);
  process.exit(1);
});
