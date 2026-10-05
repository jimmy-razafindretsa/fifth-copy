import "server-only";
import { SignJWT } from "jose";
import { RACE_TOKEN_TTL_S, type RaceTokenClaims } from "@fifth-copy/protocol";

// Mints the HS256 race token the race server verifies at the handshake (ADR 0006, 0009).
// The secret is a parameter (callers pass env.RACE_TOKEN_SECRET); `now` is unix seconds.
export async function signRaceToken(
  claims: RaceTokenClaims,
  { secret, now = Math.floor(Date.now() / 1000) }: { secret: string; now?: number },
): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + RACE_TOKEN_TTL_S)
    .sign(new TextEncoder().encode(secret));
}
