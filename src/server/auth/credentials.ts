import "server-only";
import { z } from "zod";
import { normalizeUsername } from "@/lib/username";
import { db } from "@/server/db";
import { DUMMY_HASH, MAX_PASSWORD_LENGTH, verifyPassword } from "./password";

/** The account a correct username and password resolve to. */
export type CredentialsAccount = { id: string; name: string };

/** Thrown when the account lookup fails. Takes no arguments, so it can never carry a password or a hash. */
export class CredentialsLookupError extends Error {
  constructor() {
    super("Credentials could not be checked");
  }

  override get name() {
    return "CredentialsLookupError";
  }
}

// Bounds only (DoS guard); sign-up (#36) owns the username and password rules.
const credentialsInput = z.object({
  username: z.string().max(256).transform(normalizeUsername).pipe(z.string().min(1)),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

async function findAccount(usernameNormalized: string) {
  try {
    return await db.user.findUnique({
      where: { usernameNormalized },
      select: { id: true, typistName: true, isGuest: true, passwordHash: true },
    });
  } catch {
    throw new CredentialsLookupError();
  }
}

/**
 * The account for a username (case-insensitive, via normalizeUsername) and its password, else null: wrong
 * password, unknown username, guest row, account without a password, malformed input. Every well-formed
 * attempt runs exactly one Argon2id comparison (against DUMMY_HASH when there is no usable hash), so the
 * time taken does not tell whether the username exists. Reused by the Credentials provider, recovery and
 * teacher resets; throttling is the caller's job (#87).
 */
export async function verifyCredentials(input: unknown): Promise<CredentialsAccount | null> {
  const parsed = credentialsInput.safeParse(input);
  if (!parsed.success) return null;
  const { username, password } = parsed.data;
  const row = await findAccount(username);
  const hash = row && !row.isGuest ? row.passwordHash : null;
  const ok = await verifyPassword(password, hash ?? DUMMY_HASH);
  return ok && row && hash !== null ? { id: row.id, name: row.typistName } : null;
}
