import "server-only";
import { db } from "@/server/db";

export type Health = { ok: boolean; db: "up" | "down" };

/** Liveness + DB reachability. Used by /api/health and scripts/deploy-smoke.sh. */
export async function getHealth(): Promise<Health> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, db: "up" };
  } catch {
    return { ok: false, db: "down" };
  }
}
