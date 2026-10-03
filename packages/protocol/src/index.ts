/**
 * @fifth-copy/protocol: the single definition of every wire message (socket events, race tokens,
 * internal HTTP payloads, host race settings). Parse at the edge with these schemas; never trust raw input.
 * See packages/protocol/README.md and docs/adr/0006-real-time-race-server.md.
 */
import { z } from "zod";

/** Sent in the socket handshake and the internal API; a mismatch is rejected and the client reloads. */
export const PROTOCOL_VERSION = 1;

/** Shape every socket event follows: a discriminant plus a payload. Concrete events land one card at a time. */
export const envelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.string().min(1),
});
export type Envelope = z.infer<typeof envelopeSchema>;
