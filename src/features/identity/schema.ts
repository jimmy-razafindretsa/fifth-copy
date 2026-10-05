/** Canonical form for case-insensitive username uniqueness (stored in User.usernameNormalized). */
export function normalizeUsername(username: string): string {
  return username.normalize("NFKC").trim().toLowerCase();
}
