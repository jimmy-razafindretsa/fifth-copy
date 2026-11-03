import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  getViewer,
  requireViewer,
  UnauthenticatedError,
  type Viewer,
  type ViewerResolver,
} from "./index";
import { signGuestCookie } from "./guest-cookie";
import { resolveGuest, resolveSession, viewerResolvers } from "./resolvers";
import { resolveViewer } from "./viewer";

// The default chain is [session, guest]: a mocked cookie jar, Auth.js `auth()` and DB, no real env.
const SECRET = "t".repeat(32);
const findUnique = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => vi.fn());
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: () => undefined,
    delete: () => undefined,
  }),
}));
vi.mock("@/env", () => ({ env: { AUTH_SECRET: "t".repeat(32), NODE_ENV: "test" } }));
vi.mock("@/server/db", () => ({ db: { user: { findUnique } } }));
vi.mock("./auth", () => ({ auth, handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

beforeEach(() => {
  jar.clear();
  findUnique.mockReset();
  auth.mockReset();
});

const alice: Viewer = { id: "a", name: "Alice", isGuest: false, hasAvatar: true };
const bob: Viewer = { id: "b", name: "Bob", isGuest: true, hasAvatar: false };

describe("Viewer", () => {
  it("has exactly id, name, isGuest and hasAvatar", () => {
    expectTypeOf<Viewer>().toEqualTypeOf<{
      id: string;
      name: string;
      isGuest: boolean;
      hasAvatar: boolean;
    }>();
  });
});

describe("resolveViewer", () => {
  it("returns null for an empty chain", async () => {
    await expect(resolveViewer([])).resolves.toBeNull();
  });

  it("returns the first non-null viewer, in order", async () => {
    const chain: ViewerResolver[] = [async () => null, async () => alice, async () => bob];
    await expect(resolveViewer(chain)).resolves.toEqual(alice);
  });

  it("stops at the first non-null viewer", async () => {
    const later = vi.fn<ViewerResolver>(async () => bob);
    await expect(resolveViewer([async () => alice, later])).resolves.toEqual(alice);
    expect(later).not.toHaveBeenCalled();
  });
});

describe("getViewer", () => {
  it("resolves nobody with the default chain and no cookie, without a DB read", async () => {
    await expect(getViewer()).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
    expect(auth).not.toHaveBeenCalled();
  });
});

// #787 C2: the session resolver comes first, the guest cookie resolver last.
describe("viewerResolvers (C2)", () => {
  const rows: Record<string, object> = {
    acct: { id: "acct", typistName: "Ada-0042", isGuest: false, tokenVersion: 2, avatarStatus: "NONE" },
    gst: { id: "gst", typistName: "Comrade-123", isGuest: true, tokenVersion: 0, avatarStatus: "NONE" },
  };
  const account: Viewer = { id: "acct", name: "Ada-0042", isGuest: false, hasAvatar: false };
  const guest: Viewer = { id: "gst", name: "Comrade-123", isGuest: true, hasAvatar: false };

  beforeEach(() => {
    findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => rows[where.id] ?? null);
  });

  function signIn(cookie = "authjs.session-token") {
    jar.set(cookie, "jwt");
    auth.mockResolvedValue({ user: { id: "acct", name: "Ada-0042", tokenVersion: 2 }, expires: "x" });
  }

  it("is [resolveSession, resolveGuest]", () => {
    expect(viewerResolvers).toEqual([resolveSession, resolveGuest]);
  });

  it("a request with a valid session and a valid fc_guest cookie resolves to the account", async () => {
    signIn();
    jar.set("fc_guest", signGuestCookie("gst", SECRET));
    await expect(getViewer()).resolves.toEqual(account);
    await expect(requireViewer()).resolves.toEqual(account);
  });

  it("reads the __Secure- session cookie too (https)", async () => {
    signIn("__Secure-authjs.session-token");
    await expect(getViewer()).resolves.toEqual(account);
  });

  it("a request with only the guest cookie still resolves to the guest, without calling auth()", async () => {
    jar.set("fc_guest", signGuestCookie("gst", SECRET));
    await expect(getViewer()).resolves.toEqual(guest);
    expect(auth).not.toHaveBeenCalled();
  });

  it("a stale session falls through to the guest", async () => {
    signIn();
    rows.acct = { ...rows.acct, tokenVersion: 3 };
    jar.set("fc_guest", signGuestCookie("gst", SECRET));
    await expect(getViewer()).resolves.toEqual(guest);
    rows.acct = { ...rows.acct, tokenVersion: 2 };
  });

  it("reads the account row with exactly the fields the resolver needs", async () => {
    signIn();
    await getViewer();
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "acct" },
      select: { typistName: true, isGuest: true, tokenVersion: true, avatarStatus: true },
    });
  });
});

describe("requireViewer", () => {
  it("throws UnauthenticatedError carrying no request data when nobody is resolved", async () => {
    const err = await requireViewer().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthenticatedError);
    expect((err as Error).message).toBe("Unauthenticated");
    expect(Object.keys(err as object)).toEqual([]);
  });
});
