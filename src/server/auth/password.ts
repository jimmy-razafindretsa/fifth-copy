import "server-only";
import { hash, verify, type Algorithm, type Options } from "@node-rs/argon2";

// Argon2id at OWASP's minimum cost (ADR 0009): 19 MiB, 2 passes, 1 lane.
// `Algorithm` is an ambient const enum, which isolatedModules cannot read: 2 is Argon2id.
const PARAMS = {
  algorithm: 2 as Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} satisfies Options;

/** Longest password hashed or compared: bounds the work one request can ask for. */
export const MAX_PASSWORD_LENGTH = 1024;

/**
 * A hash of a discarded random value with PARAMS: comparing a password against it costs the same as a real
 * comparison, so unknown accounts take the same time as wrong passwords. Matches nothing anyone can type.
 */
export const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$HjKl77PVSnKZafZswQF+/w$5BNEDJjaRO8noGEXNehDKYHhKf3z91USwvx9NBx++dA";

/** Thrown by hashPassword. Takes no arguments, so it can never carry a password or a hash. */
export class PasswordError extends Error {
  constructor() {
    super("Password could not be hashed");
  }

  override get name() {
    return "PasswordError";
  }
}

const usable = (plain: unknown): plain is string =>
  typeof plain === "string" && plain.length <= MAX_PASSWORD_LENGTH;

/** Argon2id PHC string of `plain` with a fresh random salt. */
export async function hashPassword(plain: string): Promise<string> {
  if (!usable(plain)) throw new PasswordError();
  try {
    return await hash(plain, PARAMS);
  } catch {
    throw new PasswordError();
  }
}

/** True only when `plain` is the password behind `phc`; false (never a throw) for anything malformed. */
export async function verifyPassword(plain: string, phc: string): Promise<boolean> {
  if (!usable(plain) || typeof phc !== "string" || !phc.startsWith("$argon2id$")) return false;
  try {
    return await verify(phc, plain);
  } catch {
    return false;
  }
}
