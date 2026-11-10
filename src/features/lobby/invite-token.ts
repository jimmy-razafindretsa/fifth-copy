import { randomBytes } from "node:crypto";
import { z } from "zod";

// Invite tokens (#808, ADR 0008): the single-use join credential a lobby's host issues. 32 random
// bytes, base64url without padding. Every action and the `/invite/[token]` route (#809) parse a
// token with this one regex. A token is never written to a log line, a cookie or a `Lobby` row.

/** Exactly 43 base64url characters: the encoding of 32 bytes, no padding. */
export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Untrusted token input (a route param, an action argument). */
export const inviteTokenSchema = z.string().regex(INVITE_TOKEN_RE);

/** A fresh token: 32 bytes from the CSPRNG. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}
