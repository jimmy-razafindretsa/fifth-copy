import "server-only";
import { randomInt } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

/** Picks the typist name of an account created through Auth.js (OAuth sign-up, #49). */
export type TypistNameFor = (profile: { name?: string | null }) => Promise<string>;

const MAX_LENGTH = 32;
const FALLBACK = "Typist";
const ATTEMPTS = 20;

/** Trims, folds whitespace, drops control and format characters and caps the length. */
function clean(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFKC")
    .replace(/\p{C}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LENGTH)
    .trim();
}

/**
 * The mapper of OAuth sign-up (#786, #49): the provider login when it passes `isClean` (profanity screen,
 * injected: src/server never imports features) and is free, else the login (or "Typist" for an unclean
 * or empty one) with a random 3-digit suffix, like guest names. Without `isClean` every login counts as
 * unclean (fail closed). A free name can still be taken by a concurrent insert; the adapter retries on
 * the unique violation.
 */
export function createTypistNameFor(
  db: Pick<PrismaClient, "user">,
  {
    isClean = () => false,
    suffix = () => randomInt(0, 1000),
  }: { isClean?: (name: string) => boolean; suffix?: () => number } = {},
): TypistNameFor {
  const isFree = async (typistName: string) =>
    (await db.user.findUnique({ where: { typistName }, select: { id: true } })) === null;

  return async ({ name }) => {
    const cleaned = clean(name);
    const base = cleaned && isClean(cleaned) ? cleaned : "";
    if (base && (await isFree(base))) return base;
    const stem = base || FALLBACK;
    for (let i = 0; i < ATTEMPTS; i++) {
      const candidate = `${stem}-${String(suffix()).padStart(3, "0")}`;
      if (await isFree(candidate)) return candidate;
    }
    throw new Error("No free typist name");
  };
}
