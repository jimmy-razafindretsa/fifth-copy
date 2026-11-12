"use server";

import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import type { InviteOutcome } from "../types";
import { redeemInvite } from "./redeem-invite";

/** The invitation form's state: `null` until a press is refused. */
export type TakeInviteState = { outcome: Exclude<InviteOutcome, "invite"> | null };

const formSchema = z.object({ token: z.string() });

/**
 * `TAKE YOUR DESK` (#809, ADR 0009): the form post that consumes an invite. The GET of
 * `/invite/<token>` only peeks, so a link preview or a prefetch never burns it. `redeemInvite` parses
 * the token and spends the `invite-redeem` budget; on success the page goes to `/lobby/<code>`
 * (replacing the invite page in history), where the token mint creates the guest. The token never
 * reaches the lobby URL, a cookie or a log line. A miss (used, expired, or lost to another press)
 * is `refused`.
 */
export async function takeInvite(_prev: TakeInviteState, form: FormData): Promise<TakeInviteState> {
  const parsed = formSchema.safeParse({ token: form.get("token") });
  if (!parsed.success) return { outcome: "refused" };
  const result = await redeemInvite({ token: parsed.data.token });
  if (result.ok) redirect(`/lobby/${result.code}`, RedirectType.replace);
  switch (result.error) {
    case "closed":
    case "rate-limited":
    case "unavailable":
      return { outcome: result.error };
    default:
      return { outcome: "refused" };
  }
}
