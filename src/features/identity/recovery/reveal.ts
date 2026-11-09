import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
import { env } from "@/env";
import { createRedisClient } from "@/server/redis";
import { logger } from "@/server/logger";
import { RECOVERY_CODE_WORDS } from "./generate";

// The one-shot reveal after sign-up (#46 C2, ADR 0009). Sign-up leaves the plaintext words in an
// encrypted (A256GCM), HttpOnly, SameSite=Strict cookie scoped to the reveal path, 10 minutes; nothing
// stores the plaintext on our side. The reveal page opens it for the signed-in owner only and claims its
// id once in Redis (`SET NX`), so a reload, a second tab or a replayed cookie never shows it again.
// The acknowledgement deletes the cookie. Logs carry neither the words nor the id.

export const REVEAL_COOKIE = "fc_recovery";
export const REVEAL_PATH = "/sign-up/recovery";
const REVEAL_MAX_AGE_S = 600;
const CLAIM_TTL_S = REVEAL_MAX_AGE_S * 2;
const CLAIM_TIMEOUT_MS = 1_000;

const key = () => createHash("sha256").update(`fc-recovery-reveal:${env.AUTH_SECRET}`).digest();

/** Leaves the words for the reveal page (call from the sign-up action, before its redirect). */
export async function stashReveal(userId: string, words: readonly string[]): Promise<void> {
  const sealed = await new EncryptJWT({ words: [...words] })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${REVEAL_MAX_AGE_S}s`)
    .encrypt(key());
  (await cookies()).set(REVEAL_COOKIE, sealed, {
    path: REVEAL_PATH,
    maxAge: REVEAL_MAX_AGE_S,
    httpOnly: true,
    sameSite: "strict",
    secure: env.NODE_ENV === "production",
  });
}

/** Deletes the reveal cookie (the acknowledgement). */
export async function dropReveal(): Promise<void> {
  (await cookies()).set(REVEAL_COOKIE, "", { path: REVEAL_PATH, maxAge: 0 });
}

let redis: ReturnType<typeof createRedisClient> | undefined;

/**
 * True on the first claim of `jti`, false on a replay. Fails open when Redis cannot answer: the cookie
 * only reaches its signed-in owner on this path, and a code never seen would lose the account.
 */
async function claimOnce(jti: string): Promise<boolean> {
  if (!env.REDIS_URL) return env.NODE_ENV !== "production";
  redis ??= createRedisClient(env.REDIS_URL);
  try {
    const set = await Promise.race([
      redis.set(`web:recovery:reveal:${jti}`, "1", "EX", CLAIM_TTL_S, "NX"),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), CLAIM_TIMEOUT_MS),
      ),
    ]);
    return set === "OK";
  } catch {
    logger.warn("recovery reveal store unavailable", {});
    return true;
  }
}

/**
 * The words to show once to `userId`, or null: no cookie, sealed for someone else, expired, forged, or
 * already shown. Consumes the reveal: the next call with the same cookie answers null.
 */
export async function takeReveal(userId: string): Promise<string[] | null> {
  const sealed = (await cookies()).get(REVEAL_COOKIE)?.value;
  if (!sealed) return null;
  let payload;
  try {
    ({ payload } = await jwtDecrypt(sealed, key(), { keyManagementAlgorithms: ["dir"] }));
  } catch {
    return null;
  }
  const words = payload.words;
  if (
    payload.sub !== userId ||
    typeof payload.jti !== "string" ||
    !Array.isArray(words) ||
    words.length !== RECOVERY_CODE_WORDS ||
    !words.every((w) => typeof w === "string")
  ) {
    return null;
  }
  return (await claimOnce(payload.jti)) ? (words as string[]) : null;
}
