import { describe, expect, it, vi } from "vitest";
import { getMedals } from "./get-medals";

vi.mock("server-only", () => ({}));

describe("getMedals (#999 C36)", () => {
  it("reads only the viewer's own awards and shelves them", async () => {
    const findMany = vi.fn(async () => [
      { achievementId: "first-win", awardedAt: new Date("2026-11-18T12:00:00Z") },
    ]);
    const shelf = await getMedals(
      { id: "u1" },
      { db: { achievement: { findMany } } as never, now: new Date("2026-11-19T12:00:00Z") },
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      select: { achievementId: true, awardedAt: true },
    });
    expect(shelf!.earned).toBe(1);
    expect(shelf!.medals[0]).toMatchObject({ id: "first-win", state: "new" });
  });

  it("no viewer, no read and no shelf", async () => {
    const findMany = vi.fn();
    expect(await getMedals(null, { db: { achievement: { findMany } } as never })).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
