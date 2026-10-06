import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GUEST_COOKIE, signGuestCookie } from "@/server/auth/guest-cookie";

const SECRET = "u".repeat(32);
type Row = {
  id: string;
  typistName: string;
  isGuest: boolean;
  avatarKey: string | null;
  avatarStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
};

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  rows: [] as Row[],
  dir: "",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/env", () => ({
  env: {
    AUTH_SECRET: "u".repeat(32),
    NODE_ENV: "test",
    get AVATAR_DIR() {
      return state.dir;
    },
  },
}));
vi.mock("@/server/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          state.rows.find((r) => r.id === where.id) ?? null,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = state.rows.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      }),
    },
  },
}));
vi.mock("../avatars/store-avatar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../avatars/store-avatar")>();
  return { ...actual, storeAvatar: vi.fn(actual.storeAvatar) };
});

const { uploadAvatar } = await import("./upload-avatar");
const { storeAvatar, MAX_AVATAR_BYTES } = await import("../avatars/store-avatar");
const { revalidatePath } = await import("next/cache");
const { db } = await import("@/server/db");
const { UnauthenticatedError } = await import("@/server/auth");

const guest = (id: string): Row => ({
  id,
  typistName: `Otter-${id}`,
  isGuest: true,
  avatarKey: null,
  avatarStatus: "NONE",
});
const signIn = (id: string) => state.jar.set(GUEST_COOKIE, signGuestCookie(id, SECRET));

async function png(width = 200, height = 200) {
  return sharp({ create: { width, height, channels: 3, background: "#c33" } })
    .png()
    .toBuffer();
}

function form(file: Blob | null, crop: unknown = { x: 0, y: 0, size: 100 }, extra = {}) {
  const data = new FormData();
  if (file) data.set("file", file, "avatar.png");
  if (crop !== undefined) data.set("crop", typeof crop === "string" ? crop : JSON.stringify(crop));
  for (const [k, v] of Object.entries(extra)) data.set(k, String(v));
  return data;
}

describe("uploadAvatar (server action)", () => {
  // One AVATAR_DIR for the file (the app's store is a module singleton), emptied before each test.
  beforeEach(async () => {
    state.dir ||= await mkdtemp(path.join(tmpdir(), "fc-upload-avatar-"));
    for (const entry of await readdir(state.dir))
      await rm(path.join(state.dir, entry), { recursive: true, force: true });
    state.jar.clear();
    state.rows = [guest("alice"), guest("bob")];
    vi.clearAllMocks();
  });
  afterAll(() => rm(state.dir, { recursive: true, force: true }));

  it("C7: an anonymous request is refused before anything is read or written", async () => {
    await expect(uploadAvatar(form(new Blob([await png()])))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(storeAvatar).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("C7: a guest uploads; the row gets the new key and status; the header is revalidated", async () => {
    signIn("alice");
    const result = await uploadAvatar(form(new Blob([await png()])));
    expect(result).toEqual({ ok: true, version: expect.any(Number) });
    const version = (result as { version: number }).version;
    expect(state.rows[0]).toMatchObject({
      avatarKey: `alice/${version}`,
      avatarStatus: "APPROVED",
    });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "alice" },
      data: { avatarKey: `alice/${version}`, avatarStatus: "APPROVED" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(await readdir(path.join(state.dir, "alice"))).toHaveLength(2);
  });

  it("C7: a second viewer cannot set another user's avatar (any userId field is ignored)", async () => {
    signIn("bob");
    const result = await uploadAvatar(
      form(new Blob([await png()]), undefined, { userId: "alice", id: "alice" }),
    );
    expect(result.ok).toBe(true);
    expect(state.rows.find((r) => r.id === "alice")).toMatchObject({
      avatarKey: null,
      avatarStatus: "NONE",
    });
    expect(state.rows.find((r) => r.id === "bob")?.avatarKey).toMatch(/^bob\/\d+$/);
    expect(await readdir(state.dir)).toEqual(["bob"]);
  });

  it("C7: the 5 MB cap is enforced before the bytes are read or decoded", async () => {
    signIn("alice");
    const big = new Blob([new Uint8Array(MAX_AVATAR_BYTES + 1)]);
    const arrayBuffer = vi.spyOn(big, "arrayBuffer");
    expect(await uploadAvatar(form(big))).toEqual({ ok: false, code: "TooLarge" });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(storeAvatar).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it.each([
    ["no file", null, { x: 0, y: 0, size: 100 }, "WrongType"],
    ["a string instead of a file", "text", { x: 0, y: 0, size: 100 }, "WrongType"],
    ["no crop", "png", undefined, "BadCrop"],
    ["crop that is not JSON", "png", "{x:", "BadCrop"],
    ["crop with fractions", "png", { x: 0.5, y: 0, size: 100 }, "BadCrop"],
    ["crop out of bounds", "png", { x: 150, y: 0, size: 100 }, "BadCrop"],
    ["an SVG", "svg", { x: 0, y: 0, size: 100 }, "WrongType"],
    ["a 63 px image", "tiny", { x: 0, y: 0, size: 63 }, "TooSmall"],
  ] as const)("C5/C7: %s maps to %s, nothing written", async (_l, kind, crop, code) => {
    signIn("alice");
    const data = new FormData();
    if (kind === "png") data.set("file", new Blob([await png()]));
    if (kind === "tiny") data.set("file", new Blob([await png(63, 63)]));
    if (kind === "svg") data.set("file", new Blob(["<svg xmlns='http://www.w3.org/2000/svg'/>"]));
    if (kind === "text") data.set("file", "not a file");
    if (crop !== undefined)
      data.set("crop", typeof crop === "string" ? crop : JSON.stringify(crop));
    expect(await uploadAvatar(data)).toEqual({ ok: false, code });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(await readdir(state.dir)).toEqual([]);
  });

  it("C7: a second upload replaces the first; the old files are removed", async () => {
    signIn("alice");
    const first = await uploadAvatar(form(new Blob([await png()])));
    await new Promise((r) => setTimeout(r, 2));
    const second = await uploadAvatar(form(new Blob([await png()])));
    const v2 = (second as { version: number }).version;
    expect(v2).not.toBe((first as { version: number }).version);
    expect((await readdir(path.join(state.dir, "alice"))).sort()).toEqual([
      `${v2}-256.webp`,
      `${v2}-64.webp`,
    ]);
    expect(state.rows[0]?.avatarKey).toBe(`alice/${v2}`);
  });
});
