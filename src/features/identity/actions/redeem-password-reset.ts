"use server";

import { fill, getT } from "@/i18n";
import { DUMMY_HASH, hashPassword, verifyPassword } from "@/server/auth";
import { db } from "@/server/db";
import { limit, requestSubject } from "@/server/limiter";
import { logger } from "@/server/logger";
import { parseResetForm, type ResetField } from "../schema";
import type { ResetFormState } from "./reset-form-state";

type Errors = Awaited<ReturnType<typeof getT>>["auth"]["reset"]["errors"];

/** A guarded consume that matched no row: the code was used, expired or superseded meanwhile. */
class NotConsumed extends Error {}

async function errors(): Promise<Errors> {
  return (await getT()).auth.reset.errors;
}

const refused = (status: "invalid" | "error", formError: string): ResetFormState => ({
  status,
  fieldErrors: {},
  formError,
});

/** The account and its newest reset row (by `issuedAt`), else null; one round trip. */
async function findTarget(usernameNormalized: string) {
  return db.user.findUnique({
    where: { usernameNormalized },
    select: {
      id: true,
      isGuest: true,
      passwordResets: {
        orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, codeHash: true, issuedAt: true, expiresAt: true, usedAt: true },
      },
    },
  });
}

/**
 * The teacher reset, redeemed (#789, ADR 0009, owner decision 2026-11-03 on #445). Unauthenticated
 * by design. In order: the form is parsed (`parseResetForm`: username, code, new password; a refusal
 * names fields and reads nothing); the attempt is counted against `password-reset-redeem` for the
 * account (`reset:<usernameNormalized>`) and for the client (`requestSubject()`), both before any
 * lookup, and either refusal compares nothing; then ONE lookup and ONE Argon2id comparison against
 * the newest reset row's hash (`DUMMY_HASH` when the account is unknown, a guest or has no row), so
 * every miss (no row, older row, expired, used, wrong code, unknown or guest username) is the same
 * `invalid` answer after the same work. A match hashes the new password, then one transaction
 * consumes the row (guarded: still unused, unexpired and the newest, so two concurrent redeems
 * consume it once) and sets `passwordHash` and `tokenVersion + 1` (every older session drops). The
 * recovery code is never touched, and the student is not signed in: the success state links to
 * `/sign-in`. The code and the passwords are never logged or returned.
 */
export async function redeemPasswordReset(form: FormData): Promise<ResetFormState> {
  const parsed = parseResetForm(form);
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

  const verdicts = await Promise.all([
    limit("password-reset-redeem", `reset:${usernameNormalized}`),
    requestSubject().then((subject) => limit("password-reset-redeem", subject)),
  ]);
  const blocked = verdicts.filter((v) => !v.ok);
  if (blocked.length > 0) {
    const retryAfterMs = Math.max(...blocked.map((v) => v.retryAfterMs));
    const m = Math.max(1, Math.ceil(retryAfterMs / 60_000));
    return {
      status: "rate-limited",
      fieldErrors: {},
      formError: fill((await errors())["rate-limited"], { m }),
      retryAfterMs,
    };
  }

  let target: Awaited<ReturnType<typeof findTarget>>;
  try {
    target = await findTarget(usernameNormalized);
  } catch {
    logger.warn("password reset lookup failed", {});
    return refused("error", (await errors()).generic);
  }
  const row = target && !target.isGuest ? (target.passwordResets[0] ?? null) : null;
  const matches = await verifyPassword(code, row?.codeHash ?? DUMMY_HASH);
  const now = new Date();
  if (!target || !row || !matches || row.usedAt !== null || row.expiresAt <= now) {
    return refused("invalid", (await errors()).invalid);
  }

  try {
    const passwordHash = await hashPassword(password);
    await db.$transaction(async (tx) => {
      const consumed = await tx.passwordReset.updateMany({
        where: {
          id: row.id,
          userId: target.id,
          usedAt: null,
          expiresAt: { gt: now },
          user: { isGuest: false, passwordResets: { none: { issuedAt: { gt: row.issuedAt } } } },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) throw new NotConsumed();
      await tx.user.update({
        where: { id: target.id },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
    });
  } catch (error) {
    if (error instanceof NotConsumed) return refused("invalid", (await errors()).invalid);
    logger.warn("password reset redeem failed", {});
    return refused("error", (await errors()).generic);
  }
  return { status: "done", fieldErrors: {}, formError: null };
}

/** `useActionState` form of `redeemPasswordReset`. */
export async function redeemPasswordResetAction(
  _prev: ResetFormState,
  form: FormData,
): Promise<ResetFormState> {
  return redeemPasswordReset(form);
}
