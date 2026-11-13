import "server-only";
import { db } from "@/server/db";

/**
 * The day the viewer's file was opened (#932, the Personnel file's "In service since"): the `User` row's
 * `createdAt`, or null when the row is gone. One read by id; it never creates anything (ADR 0009).
 */
export async function getServiceStart(viewerId: string): Promise<Date | null> {
  const row = await db.user.findUnique({ where: { id: viewerId }, select: { createdAt: true } });
  return row?.createdAt ?? null;
}
