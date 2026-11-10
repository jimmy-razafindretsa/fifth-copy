import { z } from "zod";
import { inviteTokenSchema } from "./invite-token";

// Untrusted input of joinByCode and mintRaceToken; the code itself is normalised by parseRoomCode.
export const codeInputSchema = z.object({ code: z.string().trim().min(1).max(16) });
/** mintRaceToken's input: `spectator` asks for a read-only token (#187). */
export const mintRaceTokenInputSchema = codeInputSchema.extend({
  spectator: z.boolean().optional(),
});
/** setLobbyType's input (#114): the room and the visibility to file; never a user id. */
export const setLobbyTypeInputSchema = codeInputSchema.extend({
  type: z.enum(["public", "private"]),
});
/** redeemInvite's input (#808): the token only, parsed with INVITE_TOKEN_RE. */
export const redeemInviteInputSchema = z.object({ token: inviteTokenSchema });
