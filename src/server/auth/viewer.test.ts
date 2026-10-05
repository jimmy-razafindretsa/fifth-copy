import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  getViewer,
  requireViewer,
  UnauthenticatedError,
  type Viewer,
  type ViewerResolver,
} from "./index";
import { resolveViewer } from "./viewer";

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
  it("resolves nobody with the default chain", async () => {
    await expect(getViewer()).resolves.toBeNull();
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
