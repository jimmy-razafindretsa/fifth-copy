/**
 * Idempotent development seed. Runs via `npx prisma db seed` (and after `migrate dev`).
 * Always guarded: refuses to run against a non-local database.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createPrismaClient } from "../src/server/db-client";

execFileSync("scripts/db-guard.sh", { stdio: "inherit" });

async function main() {
  const db = createPrismaClient(process.env.DATABASE_URL!);
  try {
    // Add upserts here as models appear. Keep it idempotent.
    await db.$queryRaw`SELECT 1`;
    console.log("seed: ok");
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error("seed: failed", err instanceof Error ? err.message : err);
  process.exit(1);
});
