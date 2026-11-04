"use server";

import { getViewer, hashPassword } from "@/server/auth";
import { db } from "@/server/db";
import { limit } from "@/server/limiter";
import { RESET_CODE_TTL_MS, formatResetCode, generateResetCode } from "../password-reset/code";
import { findResetTarget, findTeacherLobby } from "../queries/reset-eligibility";
import { issuePasswordResetInput } from "../schema";

export type IssuePasswordResetResult =
  | { ok: true; code: string; expiresAt: Date }
  | { ok: false; error: "invalid" | "not-host" | "not-eligible" }
  | { ok: false; error: "rate-limited"; retryAfterMs: number };

/** A lookup that fails (database down, a value it rejects) reads as "no match", never a throw. */
const orNull = <T>(lookup: Promise<T | null>): Promise<T | null> => lookup.catch(() => null);

/**
 * The teacher reset (#788, owner decisions 2026-11-03 on #445 and 2026-11-04 on #788): the host of
 * the lobby named by `code`, an account flagged `isTeacher` (granted out of band), issues a
 * single-use, 30-minute code for a student who raced in one of their lobbies. Order: zod first (no
 * control characters); then the viewer must be a non-guest account, the row's `hostUserId` (never an
 * id from the input; no guest is ever created) and a teacher; then the host's `password-reset-issue`
 * limit (refusals count too); then ONE student lookup, so every refusal is the same `not-eligible`
 * from the same round trip. A failed lookup refuses, never throws. The code is returned once and
 * only its Argon2id hash is stored; the row is the audit record. A new issuance adds a row (the
 * newest one is redeemable, R2); the student's recovery code is never touched.
 */
export async function issuePasswordReset(input: {
  code: string;
  username: string;
}): Promise<IssuePasswordResetResult> {
  const parsed = issuePasswordResetInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { code: lobbyCode, username } = parsed.data;

  const viewer = await getViewer();
  if (!viewer || viewer.isGuest) return { ok: false, error: "not-host" };
  if (!(await orNull(findTeacherLobby(lobbyCode, viewer.id)))) {
    return { ok: false, error: "not-host" };
  }

  const verdict = await limit("password-reset-issue", `user:${viewer.id}`);
  if (!verdict.ok) return { ok: false, error: "rate-limited", retryAfterMs: verdict.retryAfterMs };

  const student = await orNull(findResetTarget(viewer.id, username));
  if (!student) return { ok: false, error: "not-eligible" };

  const plain = generateResetCode();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + RESET_CODE_TTL_MS);
  await db.passwordReset.create({
    data: {
      userId: student.id,
      codeHash: await hashPassword(plain),
      issuedByUserId: viewer.id,
      lobbyCode,
      issuedAt,
      expiresAt,
    },
  });
  return { ok: true, code: formatResetCode(plain), expiresAt };
}
