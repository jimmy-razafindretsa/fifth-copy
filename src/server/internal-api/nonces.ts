import "server-only";
import { INTERNAL_NONCE_HEX, INTERNAL_NONCE_TTL_S } from "@fifth-copy/protocol";
import { env } from "@/env";
import { createRedisClient } from "../redis";

// The web's internal-request replay store (#716, ARCHITECTURE 10): race server -> web requests
// claim their signed nonce once, like the race server does for web -> race server (#518). Fails
// closed (ADR 0020 amendment): a replay control that admits on a Redis outage is no control.

/** A claim slower than this counts as Redis unavailable (above the limiter's 250 ms: refusing costs a retry). */
export const NONCE_TIMEOUT_MS = 1_000;

/** `claimed`: first use; `replay`: seen within the TTL; `unavailable`: Redis down or slow (refuse, 503). */
export type NonceClaim = "claimed" | "replay" | "unavailable";
export type NonceStore = { claim(nonce: string): Promise<NonceClaim> };
type Warn = (msg: string, fields: Record<string, unknown>) => void;

const defaultWarn: Warn = (msg, fields) =>
  console.warn(JSON.stringify({ level: "warn", msg, ...fields }));

/** The web's own key family (ADR 0008: one owner per family), distinct from the race server's `internal:nonce:`. */
export function webNonceKey(nonce: string): string {
  if (!INTERNAL_NONCE_HEX.test(nonce)) throw new TypeError("malformed nonce");
  return `web:internal:nonce:${nonce}`;
}

/**
 * Call `claim` only after the timestamp and signature verified (`requireInternal`). One
 * `SET NX EX ttlS`, so two concurrent claims cannot both win and a reuse never extends the TTL.
 * `url` set: a Redis error or a call slower than `timeoutMs` is `unavailable` (one warning per
 * outage; a SET that lands after the timeout keeps its key, harmless: the race server signs a fresh
 * nonce on every attempt). `url` absent: production refuses every claim (src/env.ts already refuses
 * to boot), development and test admit every claim with one warning (Playwright runs the web
 * without a store). Logs carry no URL and no nonce.
 */
export function createWebNonceStore({
  url,
  nodeEnv,
  ttlS = INTERNAL_NONCE_TTL_S,
  timeoutMs = NONCE_TIMEOUT_MS,
  warn = defaultWarn,
}: {
  url: string | undefined;
  nodeEnv: "development" | "test" | "production";
  ttlS?: number;
  timeoutMs?: number;
  warn?: Warn;
}): NonceStore & { close(): void } {
  if (!url) {
    let warned = false;
    const outcome: NonceClaim = nodeEnv === "production" ? "unavailable" : "claimed";
    return {
      async claim(nonce) {
        webNonceKey(nonce);
        if (!warned) {
          warned = true;
          warn("internal nonce store disabled", { cause: "REDIS_URL not set" });
        }
        return outcome;
      },
      close: () => {},
    };
  }

  let redis: ReturnType<typeof createRedisClient> | undefined;
  let down = false;
  const unavailable = (cause: string): NonceClaim => {
    if (!down) {
      down = true;
      warn("internal nonce store unavailable, refusing", { cause });
    }
    return "unavailable";
  };

  return {
    async claim(nonce) {
      const key = webNonceKey(nonce);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      });
      try {
        redis ??= createRedisClient(url);
        const pending = redis.set(key, "1", "EX", ttlS, "NX");
        // A call that loses the race must not surface as an unhandled rejection later.
        pending.catch(() => undefined);
        const result = await Promise.race([pending, timeout]);
        if (result === "timeout") return unavailable("timeout");
        down = false;
        return result === "OK" ? "claimed" : "replay";
      } catch (err) {
        return unavailable((err as NodeJS.ErrnoException).code ?? "error");
      } finally {
        clearTimeout(timer);
      }
    },
    close: () => redis?.disconnect(),
  };
}

let current: { url: string | undefined; store: NonceStore & { close(): void } } | undefined;

/** The process's store, created lazily from `env.REDIS_URL` (keyed on it, so a test that swaps the mocked env gets a fresh one). */
export function webNonceStore(): NonceStore {
  if (!current || current.url !== env.REDIS_URL) {
    current?.store.close();
    current = {
      url: env.REDIS_URL,
      store: createWebNonceStore({ url: env.REDIS_URL, nodeEnv: env.NODE_ENV }),
    };
  }
  return current.store;
}
