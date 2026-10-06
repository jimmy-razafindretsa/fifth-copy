/**
 * Who the board tooling believes (pure, no network). The repository is public: anyone can comment on a card,
 * so gates, `pickup-branch` and agents act only on comments whose author is in the trusted set.
 * Set: env `BOARD_TRUSTED_AUTHORS` (comma-separated logins), default the repository owner from `BOARD_REPO`.
 * Logins compare case-insensitively (GitHub logins are case-insensitive); a null author (deleted account) is
 * never trusted. Used by flow.ts (gates, latestPickup) and board.ts (formatComment).
 */

export type Comment = { body: string; createdAt: string; author: string | null };

/** The trusted logins, lowercased. An unset or blank env falls back to the owner. */
export function trustedAuthors(env: string | undefined, owner: string): ReadonlySet<string> {
  const list = (env ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(list.length ? list : [owner.trim().toLowerCase()].filter(Boolean));
}

export const isTrusted = (c: Pick<Comment, "author">, trusted: ReadonlySet<string>): boolean =>
  c.author !== null && c.author !== "" && trusted.has(c.author.toLowerCase());

export const trustedOnly = <C extends Pick<Comment, "author">>(
  comments: readonly C[],
  trusted: ReadonlySet<string>,
): C[] => comments.filter((c) => isTrusted(c, trusted));
