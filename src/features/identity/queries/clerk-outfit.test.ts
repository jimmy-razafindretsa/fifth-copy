import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const table = vi.hoisted(() => new Map<string, { outfit: unknown }>());
const findUnique = vi.hoisted(() =>
  vi.fn(
    async ({ where }: { where: { id: string }; select: unknown }) => table.get(where.id) ?? null,
  ),
);
vi.mock("@/server/db", () => ({ db: { user: { findUnique } } }));

const { getClerkOutfit } = await import("./clerk-outfit");

const OUTFIT = {
  hair: "buzz",
  glasses: "round",
  hat: "kepka",
  clothes: "vest",
  face: "clean",
  hairCol: "#A4552A",
};

describe("getClerkOutfit (C5, fake table)", () => {
  beforeEach(() => {
    table.clear();
    findUnique.mockClear();
  });

  it("reads one row, selecting only outfit", async () => {
    table.set("u1", { outfit: OUTFIT });
    await expect(getClerkOutfit("u1")).resolves.toEqual(OUTFIT);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "u1" }, select: { outfit: true } });
  });

  it("is null for no row", async () => {
    await expect(getClerkOutfit("nobody")).resolves.toBeNull();
  });

  it("is null for a row with nothing saved", async () => {
    table.set("u1", { outfit: null });
    await expect(getClerkOutfit("u1")).resolves.toBeNull();
  });

  it.each([
    ["a retired id", { ...OUTFIT, hat: "crown" }],
    ["a missing slot", { ...OUTFIT, face: undefined }],
    ["not an object", "side"],
  ])("is null for a stored value the catalogue no longer accepts (%s)", async (_n, outfit) => {
    table.set("u1", { outfit });
    await expect(getClerkOutfit("u1")).resolves.toBeNull();
  });

  it("drops unknown stored keys", async () => {
    table.set("u1", { outfit: { ...OUTFIT, legacy: true } });
    await expect(getClerkOutfit("u1")).resolves.toEqual(OUTFIT);
  });
});
