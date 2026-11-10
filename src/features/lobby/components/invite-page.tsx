import { notFound } from "next/navigation";
import { getT } from "@/i18n";
import { peekInvite } from "../actions/redeem-invite";
import { INVITE_TOKEN_RE } from "../invite-token";
import type { InviteOutcome } from "../types";
import { InviteFlow } from "./invite-screen";

/**
 * `/invite/[token]` (#809, ADR 0009): a malformed token is `notFound()`; otherwise one peek (EXISTS,
 * consumes nothing, so a link preview, a prefetch or a second open leaves the link whole) picks the
 * invitation or the refusal. Only the `TAKE YOUR DESK` form post consumes the token.
 */
export async function InvitePage({ token }: { token: string }) {
  if (!INVITE_TOKEN_RE.test(token)) notFound();
  const peek = await peekInvite(token);
  let initial: InviteOutcome = "invite";
  if (!peek.ok) {
    if (peek.error === "invalid") notFound();
    initial = peek.error === "not-found" ? "refused" : peek.error;
  }
  const t = await getT();
  return (
    <InviteFlow
      token={token}
      initial={initial}
      labels={t.invite}
      errors={t.landing.errors}
      entry={t.landing.actions}
    />
  );
}
