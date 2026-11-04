"use server";

import { redirect } from "next/navigation";
import { isClean } from "@/features/texts";
import { Prisma } from "@/generated/prisma/client";
import { getT } from "@/i18n";
import { getViewer, hashPassword, signIn as authSignIn } from "@/server/auth";
import { db } from "@/server/db";
import { logger } from "@/server/logger";
import { mergeGuestCookieInto } from "../merge/merge-on-sign-in";
import { type AuthField, parseSignUp } from "../schema";
import type { AuthFormState } from "./auth-form-state";

/** Where a new account lands until the recovery-code reveal (#46) is appended after creation. */
const AFTER_SIGN_UP = "/";

type ErrorKey = keyof Awaited<ReturnType<typeof getT>>["auth"]["errors"];

async function refuse(fields: Partial<Record<AuthField, ErrorKey>>, form?: ErrorKey) {
  const errors = (await getT()).auth.errors;
  return {
    fieldErrors: Object.fromEntries(
      Object.entries(fields).map(([field, key]) => [field, errors[key]]),
    ),
    formError: form ? errors[form] : null,
  } satisfies AuthFormState;
}

/** Taken = the normalized username, or the display name in any case (no look-alike of a typist name). */
async function isTaken(username: string, usernameNormalized: string): Promise<boolean> {
  const row = await db.user.findFirst({
    where: {
      OR: [{ usernameNormalized }, { typistName: { equals: username, mode: "insensitive" } }],
    },
    select: { id: true },
  });
  return row !== null;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Username sign-up (#36 C1-C4, ADR 0009, R147, R149, R152, R154, R161). In order: a signed-in account
 * is refused (no second account); the form is parsed (`parseSignUp`: exactly username and password);
 * the profanity filter, then the case-insensitive availability check, run here on the server only;
 * the account is created (Argon2id hash, `isGuest=false`, `typistName=username`; a concurrent insert of
 * the same name reads as taken), signed in through Auth.js (JWT cookie), the guest cookie's history
 * merged and the cookie cleared; then the redirect. Errors come back in the viewer's locale.
 */
export async function signUp(form: FormData): Promise<AuthFormState> {
  const viewer = await getViewer();
  if (viewer && !viewer.isGuest) return refuse({}, "alreadySignedIn");

  const parsed = parseSignUp(form);
  if (!parsed.ok) return refuse(parsed.fieldErrors, parsed.extraField ? "fields" : undefined);
  const { username, usernameNormalized, password } = parsed;

  if (!isClean(username)) return refuse({ username: "usernameRefused" });
  if (await isTaken(username, usernameNormalized)) return refuse({ username: "usernameTaken" });

  let accountId: string;
  try {
    ({ id: accountId } = await db.user.create({
      data: {
        isGuest: false,
        typistName: username,
        username,
        usernameNormalized,
        passwordHash: await hashPassword(password),
      },
      select: { id: true },
    }));
  } catch (error) {
    if (isUniqueViolation(error)) return refuse({ username: "usernameTaken" });
    throw error;
  }

  if (!(await startSession(username, password))) return refuse({}, "generic");
  await mergeGuestCookieInto(accountId);
  redirect(AFTER_SIGN_UP);
}

/** `useActionState` form of `signUp`. */
export async function signUpAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  return signUp(form);
}

/** Sets the session cookie through Auth.js for the account just created; false when Auth.js refuses. */
async function startSession(username: string, password: string): Promise<boolean> {
  try {
    await authSignIn("credentials", { username, password, redirect: false });
    return true;
  } catch (error) {
    logger.warn("sign-in after sign-up failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}
