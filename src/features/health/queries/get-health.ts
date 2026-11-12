import "server-only";
import { PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { env } from "@/env";
import { db } from "@/server/db";

/**
 * `commit` is the deployed commit (Railway's RAILWAY_GIT_COMMIT_SHA, null elsewhere) and `protocol` the
 * running PROTOCOL_VERSION: the deploy-check workflow compares both with main (#718, ADR 0019).
 */
export type Health = { ok: boolean; db: "up" | "down"; commit: string | null; protocol: number };

/** Liveness + DB reachability. Used by /api/health, scripts/deploy-smoke.sh and scripts/deploy-check.ts. */
export async function getHealth(): Promise<Health> {
  const build = { commit: env.RAILWAY_GIT_COMMIT_SHA ?? null, protocol: PROTOCOL_VERSION };
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, db: "up", ...build };
  } catch {
    return { ok: false, db: "down", ...build };
  }
}
