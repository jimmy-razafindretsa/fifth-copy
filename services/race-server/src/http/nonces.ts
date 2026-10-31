import type { Redis } from "ioredis";
import { INTERNAL_NONCE_TTL_S } from "@fifth-copy/protocol";
import { nonceKey } from "../rooms/keys";

export type NonceStore = {
  /**
   * Records a nonce for `INTERNAL_NONCE_TTL_S`: true the first time, false on any reuse (a replay).
   * One `SET NX EX`, so two concurrent claims cannot both win and a reuse never extends the TTL.
   * A Redis error rejects (the caller fails closed, ADR 0020).
   */
  claim(nonce: string): Promise<boolean>;
};

/** Internal-request replay store (#518, ARCHITECTURE 10). Call only after the signature verified. */
export function createNonceStore({ redis }: { redis: Redis }): NonceStore {
  return {
    async claim(nonce) {
      return (await redis.set(nonceKey(nonce), "1", "EX", INTERNAL_NONCE_TTL_S, "NX")) === "OK";
    },
  };
}
