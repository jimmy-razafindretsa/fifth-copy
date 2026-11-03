/**
 * Canonical form for case-insensitive username uniqueness (stored in User.usernameNormalized). The one
 * normalizer for every username lookup: sign-up, sign-in (`verifyCredentials`), recovery, resets.
 */
export function normalizeUsername(username: string): string {
  return username.normalize("NFKC").trim().toLowerCase();
}
