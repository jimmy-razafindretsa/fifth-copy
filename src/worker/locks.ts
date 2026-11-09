import { Client } from "pg";

/**
 * Postgres session advisory locks, one per job name (ADR 0011). A session lock belongs to one
 * connection, so the scheduler holds a dedicated `pg` client instead of Prisma's pool: lock and
 * unlock always reach the same session, and a crashed worker's locks vanish with its connection.
 */
export type AdvisoryLocks = {
  tryLock: (name: string) => Promise<boolean>;
  unlock: (name: string) => Promise<void>;
  close: () => Promise<void>;
};

/** Namespaced so a job lock never meets another advisory lock user (e.g. prisma migrate). */
const key = (name: string) => `fifth-copy:job:${name}`;

export function createPgAdvisoryLocks(connectionString: string): AdvisoryLocks {
  const client = new Client({ connectionString });
  let connected: Promise<void> | null = null;
  const ready = () => (connected ??= client.connect());
  // A dropped connection already released its locks; surface it on the next call, never crash the process.
  client.on("error", () => undefined);

  return {
    async tryLock(name) {
      await ready();
      const res = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
        [key(name)],
      );
      return res.rows[0]?.locked === true;
    },
    async unlock(name) {
      await ready();
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key(name)]);
    },
    async close() {
      if (connected) await client.end();
    },
  };
}
