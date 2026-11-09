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
  // One session at a time. A dropped connection already released its locks on the server: forget
  // it, and the next call opens a fresh session (the scheduler logs the failed call and retries).
  let session: { client: Client; ready: Promise<Client> } | null = null;
  const connect = () => {
    if (session) return session.ready;
    const client = new Client({ connectionString });
    const drop = () => {
      if (session?.client === client) session = null;
    };
    client.on("error", drop);
    client.on("end", drop);
    const ready = client.connect().then(
      () => client,
      (err: unknown) => {
        drop();
        throw err;
      },
    );
    session = { client, ready };
    return ready;
  };

  return {
    async tryLock(name) {
      const client = await connect();
      const res = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
        [key(name)],
      );
      return res.rows[0]?.locked === true;
    },
    async unlock(name) {
      const client = await connect();
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key(name)]);
    },
    async close() {
      const current = session;
      session = null;
      if (current) await (await current.ready.catch(() => null))?.end();
    },
  };
}
