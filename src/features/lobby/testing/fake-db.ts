import { vi } from "vitest";

// Test-only in-memory User and Lobby tables with the real unique indexes (typistName, code).
// Not imported by app code. Duplicates throw a plain Error: tests that need Prisma's P2002 inject it.
type UserRow = { id: string; typistName: string; isGuest: boolean; avatarStatus: "NONE" };
type LobbyRow = { id: string; code: string; status: "WAITING" | "CLOSED"; hostUserId: string };

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
      const row: LobbyRow = { id: `lob${next++}`, status: "WAITING", ...data };
      lobbies.push(row);
      return { id: row.id, code: row.code };
    }),
    findUnique: vi.fn(
      async ({ where }: { where: { code: string } }) =>
        lobbies.find((l) => l.code === where.code) ?? null,
    ),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const index = lobbies.findIndex((l) => l.id === where.id);
      if (index < 0) throw new Error("Record to delete does not exist");
      return lobbies.splice(index, 1)[0];
    }),
  };
  const seedLobby = (row: Omit<LobbyRow, "id"> & { id?: string }) =>
    lobbies.push({ id: row.id ?? `lob${next++}`, ...row });
  return { users, lobbies, seedLobby, db: { user, lobby } };
}
