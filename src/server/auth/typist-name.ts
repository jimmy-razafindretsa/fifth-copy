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
 * The default mapper (#786): the profile name when given and free, else the name (or "Typist") with a
 * random 3-digit suffix, like guest names. #49 swaps in the profanity-checked mapper. A free name can
 * still be taken by a concurrent insert; the adapter retries on the unique violation.
 */
export function createTypistNameFor(
  db: Pick<PrismaClient, "user">,
  suffix: () => number = () => randomInt(0, 1000),
): TypistNameFor {
  const isFree = async (typistName: string) =>
    (await db.user.findUnique({ where: { typistName }, select: { id: true } })) === null;

  return async ({ name }) => {
    const base = clean(name);
    if (base && (await isFree(base))) return base;
    const stem = base || FALLBACK;
    for (let i = 0; i < ATTEMPTS; i++) {
      const candidate = `${stem}-${String(suffix()).padStart(3, "0")}`;
      if (await isFree(candidate)) return candidate;
    }
    throw new Error("No free typist name");
  };
}
