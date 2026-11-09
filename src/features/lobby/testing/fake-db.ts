import { vi } from "vitest";

// Test-only in-memory User and Lobby tables with the real unique indexes (typistName, code).
// Not imported by app code. Duplicates throw a plain Error: tests that need Prisma's P2002 inject it.
type UserRow = { id: string; typistName: string; isGuest: boolean; avatarStatus: "NONE" };
type LobbyRow = {
  id: string;
  code: string;
  status: "WAITING" | "CLOSED";
  hostUserId: string;
  type?: "PUBLIC" | "PRIVATE";
  createdAt?: Date;
};

const uniqueViolation = () => new Error("Unique constraint failed (fake db)");

export function fakeLobbyDb() {
  const users: UserRow[] = [];
  const lobbies: LobbyRow[] = [];
  let next = 0;
  const user = {
    create: vi.fn(async ({ data }: { data: { typistName: string } }) => {
      if (users.some((u) => u.typistName === data.typistName)) throw uniqueViolation();
      const row: UserRow = {
        id: `usr${next++}`,
        typistName: data.typistName,
        isGuest: true,
        avatarStatus: "NONE",
      };
      users.push(row);
      return { id: row.id, typistName: row.typistName };
    }),
    findUnique: vi.fn(
      async ({ where }: { where: { id: string } }) => users.find((u) => u.id === where.id) ?? null,
    ),
  };
  const lobby = {
    create: vi.fn(async ({ data }: { data: { code: string; hostUserId: string } }) => {
      if (lobbies.some((l) => l.code === data.code)) throw uniqueViolation();
      const row: LobbyRow = {
        id: `lob${next++}`,
        status: "WAITING",
        type: "PRIVATE",
        createdAt: new Date(),
        ...data,
      };
      lobbies.push(row);
      return { id: row.id, code: row.code };
    }),
    findUnique: vi.fn(
      async ({ where }: { where: { code: string } }) =>
        lobbies.find((l) => l.code === where.code) ?? null,
    ),
    // The subset listOpenLobbies uses (#806): equality on type/status, createdAt gte, newest first, take.
    findMany: vi.fn(
      async ({
        where = {},
        orderBy,
        take,
      }: {
        where?: {
          type?: LobbyRow["type"];
          status?: LobbyRow["status"];
          createdAt?: { gte: Date };
        };
        orderBy?: { createdAt: "desc" | "asc" };
        take?: number;
      }) => {
        const time = (row: LobbyRow) => row.createdAt?.getTime() ?? 0;
        let rows = lobbies.filter(
          (l) =>
            (where.type === undefined || l.type === where.type) &&
            (where.status === undefined || l.status === where.status) &&
            (where.createdAt === undefined || time(l) >= where.createdAt.gte.getTime()),
        );
        if (orderBy)
          rows = [...rows].sort((a, b) =>
            orderBy.createdAt === "desc" ? time(b) - time(a) : time(a) - time(b),
          );
        return rows.slice(0, take ?? rows.length).map((row) => ({ ...row }));
      },
    ),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<Omit<LobbyRow, "id">> }) => {
        const row = lobbies.find((l) => l.id === where.id);
        if (!row) throw new Error("Record to update not found");
        return Object.assign(row, data);
      },
    ),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const index = lobbies.findIndex((l) => l.id === where.id);
      if (index < 0) throw new Error("Record to delete does not exist");
      return lobbies.splice(index, 1)[0];
    }),
  };
  const seedLobby = (row: Omit<LobbyRow, "id"> & { id?: string }) =>
    lobbies.push({ id: row.id ?? `lob${next++}`, type: "PRIVATE", ...row });
  return { users, lobbies, seedLobby, db: { user, lobby } };
}
