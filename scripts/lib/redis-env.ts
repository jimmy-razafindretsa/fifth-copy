/**
 * #680: in a card worktree the unit step uses its own Redis db, never the one the worktree's e2e race
 * server holds. `scripts/worktree.sh` writes `REDIS_URL` (race server) and `REDIS_URL_TEST` (unit
 * tests); `vitest.config.ts` passes this result to `test.env`. Without a worktree (CI, the main
 * checkout) there is no `REDIS_URL_TEST` and `REDIS_URL` stays as it is.
 */
export function unitRedisEnv(env: Record<string, string | undefined>): Record<string, string> {
  return env.REDIS_URL_TEST ? { REDIS_URL: env.REDIS_URL_TEST } : {};
}
