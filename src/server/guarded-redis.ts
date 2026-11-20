import "server-only";
import { createRedisClient } from "./redis";

/** What a guarded call answers when Redis is down, slow or unset. */
export type Unavailable = "unavailable";
type Warn = (msg: string, fields: Record<string, unknown>) => void;

const defaultWarn: Warn = (msg, fields) =>
  console.warn(JSON.stringify({ level: "warn", msg, ...fields }));

/**
 * One lazy Redis client whose calls never throw (ADR 0008, the web's fail-closed stores, #999): each
 * call runs under `timeoutMs`; a missing URL, an error or a timeout is `unavailable`, warned once per
 * outage under `label` (never with the URL, a key or a value). The caller decides what `unavailable`
 * means; the stores that guard access treat it as a refusal.
 */
export function createGuardedRedis({
  url,
  label,
  timeoutMs,
  warn = defaultWarn,
}: {
  url: string | undefined;
  label: string;
  timeoutMs: number;
  warn?: Warn;
}) {
  let redis: ReturnType<typeof createRedisClient> | undefined;
  let down = false;
  const unavailable = (cause: string): Unavailable => {
    if (!down) {
      down = true;
      warn(`${label} unavailable, refusing`, { cause });
    }
    return "unavailable";
  };
  return {
    async run<T>(
      call: (r: ReturnType<typeof createRedisClient>) => Promise<T>,
    ): Promise<T | Unavailable> {
      if (!url) return unavailable("REDIS_URL not set");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      });
      try {
        redis ??= createRedisClient(url);
        const pending = call(redis);
        // A call that loses the race must not surface as an unhandled rejection later.
        pending.catch(() => undefined);
        const result = await Promise.race([pending, timeout]);
        if (result === "timeout") return unavailable("timeout");
        down = false;
        return result;
      } catch (err) {
        return unavailable((err as NodeJS.ErrnoException).code ?? "error");
      } finally {
        clearTimeout(timer);
      }
    },
    close: () => redis?.disconnect(),
  };
}
