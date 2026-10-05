import { z } from "zod";

/** Sent in the socket handshake and the internal API; a mismatch is rejected and the client reloads. */
export const PROTOCOL_VERSION = 2;

/** `v` field every payload carries; only the current version parses. */
export const versionSchema = z.literal(PROTOCOL_VERSION);

/** Shape every socket event follows: a discriminant plus a payload. Concrete events land one card at a time. */
export const envelopeSchema = z.object({
  v: versionSchema,
  type: z.string().min(1),
});
export type Envelope = z.infer<typeof envelopeSchema>;
