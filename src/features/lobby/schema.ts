import { z } from "zod";
import { inviteTokenSchema } from "./invite-token";

// Untrusted input of joinByCode and mintRaceToken; the code itself is normalised by parseRoomCode.
export const codeInputSchema = z.object({ code: z.string().trim().min(1).max(16) });
/**
 * mintRaceToken's input: `spectator` asks for a read-only token (#187); `lobbyId` (#999 C13) is the
 * room the page is for, so a code of another room is `not-found` rather than a token for that room.
 */
export const mintRaceTokenInputSchema = codeInputSchema.extend({
  spectator: z.boolean().optional(),
  lobbyId: z.string().min(1).max(128).optional(),
});
/** proveRoomCode's input (#999 C13): the race page's room and the code typed for it. */
export const proveRoomCodeInputSchema = codeInputSchema.extend({
  lobbyId: z.string().min(1).max(128),
});
/** setLobbyType's input (#114): the room and the visibility to file; never a user id. */
export const setLobbyTypeInputSchema = codeInputSchema.extend({
  type: z.enum(["public", "private"]),
});
/** redeemInvite's input (#808): the token only, parsed with INVITE_TOKEN_RE. */
export const redeemInviteInputSchema = z.object({ token: inviteTokenSchema });
/** A spectator link's token (#999 C12): the invite's shape, parsed with INVITE_TOKEN_RE. */
export const spectatorLinkTokenSchema = inviteTokenSchema;
