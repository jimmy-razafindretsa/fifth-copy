"use server";

import { fill, getT } from "@/i18n";
import { DUMMY_HASH, hashPassword, verifyPassword } from "@/server/auth";
import { db } from "@/server/db";
import { clearLimit, limit, requestSubject } from "@/server/limiter";
import { logger } from "@/server/logger";
import { parseRecoverForm, type ResetField } from "../schema";
import { issueRecoveryCode } from "./issue-recovery-code";
import type { RecoverFormState } from "./recover-form-state";

type Errors = Awaited<ReturnType<typeof getT>>["auth"]["recovery"]["errors"];

/** The guarded rotation matched no row: the code was redeemed meanwhile. */
class NotRotated extends Error {}

async function errors(): Promise<Errors> {
  return (await getT()).auth.recovery.errors;
}

const refused = (status: "invalid" | "error", formError: string): RecoverFormState => ({
  status,
  fieldErrors: {},
  formError,
});

/**
 * `/recover` (#46 C3, C4; ADR 0009, R160): a user who lost their password redeems their one-time
 * recovery code. Unauthenticated by design. In order: the form is parsed (`parseRecoverForm`: username,
 * 10 words in any order, case or accents, new password with the sign-up rules); the attempt is counted
 * against the client budget (`recovery-redeem`) and, once admitted, the account budget
 * (`recovery-redeem-account`, `recovery:<usernameNormalized>`), both before any lookup; then ONE lookup
 * and ONE Argon2id comparison against the stored hash (`DUMMY_HASH` when the account is unknown, a
 * guest or has no code), so a wrong code and an unknown username are the same `invalid` answer after
 * the same work. A match hashes the new password, then one transaction rotates the code (guarded on the
 * hash just matched, so a code redeems once), sets `passwordHash` and `tokenVersion + 1` (every older
 * session drops), and returns the new words, revealed once by the success state. The user is not
 * signed in. The code, the words and the passwords are never logged.
 */
export async function redeemRecoveryCode(form: FormData): Promise<RecoverFormState> {
  const parsed = parseRecoverForm(form);
  if (!parsed.ok) {
    const e = await errors();
    return {
      status: "fields",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.fieldErrors).map(([field, key]) => [field, e[key]]),
      ) as Partial<Record<ResetField, string>>,
      formError: parsed.extraField ? e.fields : null,
    };
  }
  const { usernameNormalized, code, password } = parsed;
  const accountSubject = `recovery:${usernameNormalized}`;

  const client = await limit("recovery-redeem", await requestSubject());
  const verdict = client.ok ? await limit("recovery-redeem-account", accountSubject) : client;
  if (!verdict.ok) {
    const m = Math.max(1, Math.ceil(verdict.retryAfterMs / 60_000));
    return {
      status: "rate-limited",
      fieldErrors: {},
      formError: fill((await errors())["rate-limited"], { m }),
      retryAfterMs: verdict.retryAfterMs,
    };
  }

  let target: { id: string; isGuest: boolean; recoveryCode: { codeHash: string } | null } | null;
  try {
    target = await db.user.findUnique({
      where: { usernameNormalized },
      select: { id: true, isGuest: true, recoveryCode: { select: { codeHash: true } } },
    });
  } catch {
    logger.warn("recovery lookup failed", {});
    return refused("error", (await errors()).generic);
  }
  const stored = target && !target.isGuest ? (target.recoveryCode?.codeHash ?? null) : null;
  const matches = await verifyPassword(code, stored ?? DUMMY_HASH);
  if (!target || stored === null || !matches) {
    return refused("invalid", (await errors()).invalid);
  }

  let words: string[];
  try {
    const passwordHash = await hashPassword(password);
    words = await db.$transaction(async (tx) => {
      const held = await tx.recoveryCode.updateMany({
        where: { userId: target.id, codeHash: stored, user: { isGuest: false } },
        data: { rotatedAt: new Date() },
      });
      if (held.count !== 1) throw new NotRotated();
      await tx.user.update({
        where: { id: target.id },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      return issueRecoveryCode(target.id, tx);
    });
  } catch (error) {
    if (error instanceof NotRotated) return refused("invalid", (await errors()).invalid);
    logger.warn("recovery redeem failed", {});
    return refused("error", (await errors()).generic);
  }
  await clearLimit("recovery-redeem-account", accountSubject);
  return { status: "done", fieldErrors: {}, formError: null, words };
}

/** `useActionState` form of `redeemRecoveryCode`. */
export async function redeemRecoveryCodeAction(
  _prev: RecoverFormState,
  form: FormData,
): Promise<RecoverFormState> {
  return redeemRecoveryCode(form);
}
