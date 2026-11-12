import { randomInt } from "node:crypto";

// The teacher reset code (#788): pure, shared by the issuance, the redeem (R2) and the host UI (R3).
// 8 characters of Crockford base32 (digits and letters without I, L, O, U) = 40 bits, drawn with
// `crypto.randomInt` (uniform, no modulo bias). Stored only as an Argon2id hash of the normalized form.

export const RESET_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RESET_CODE_LENGTH = 8;
/** A reset code is redeemable for 30 minutes after issuance. */
export const RESET_CODE_TTL_MS = 30 * 60_000;

/** A fresh code in its normalized form (8 characters, no hyphen). */
export function generateResetCode(): string {
  let code = "";
  for (let i = 0; i < RESET_CODE_LENGTH; i++) {
    code += RESET_CODE_ALPHABET[randomInt(RESET_CODE_ALPHABET.length)];
  }
  return code;
}

/** Upper-cases and strips spaces and hyphens: `"abcd-efgh"`, `"ABCD EFGH"`, `"abcdefgh"` -> `"ABCDEFGH"`. */
export function normalizeResetCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, "");
}

/** The display form `XXXX-XXXX` of a code (normalized first). */
export function formatResetCode(code: string): string {
  const c = normalizeResetCode(code);
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}
