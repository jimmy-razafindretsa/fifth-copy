import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const OPENED = new Date("2023-05-24T14:00:00Z");
const findUnique = vi.hoisted(() =>
  vi.fn(async ({ where }: { where: { id: string }; select: unknown }) =>
    where.id === "u1" ? { createdAt: new Date("2023-05-24T14:00:00Z") } : null,
  ),
);
vi.mock("@/server/db", () => ({ db: { user: { findUnique } } }));

const { getServiceStart } = await import("./service-start");

// #932 C4: the Personnel file's service line reads the viewer's own row, by id, selecting createdAt only.
describe("getServiceStart", () => {
  it("reads one row by id and selects only createdAt", async () => {
    await expect(getServiceStart("u1")).resolves.toEqual(OPENED);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "u1" }, select: { createdAt: true } });
  });

  it("is null when the row is gone", async () => {
    await expect(getServiceStart("gone")).resolves.toBeNull();
  });
});
