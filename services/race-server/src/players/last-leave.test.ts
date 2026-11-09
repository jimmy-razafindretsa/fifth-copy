import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RACE_SETTINGS } from "@fifth-copy/protocol";
import { createFakeClock, createFakeScheduler } from "../clock";
import type { RaceDesk, RoomState } from "../rooms/registry";
import { createLastLeave, LAST_LEAVE_GRACE_MS } from "./last-leave";

// #734: the last human of a waiting room leaves only after a grace, so a host reloading the lobby
// page never closes the room or its `Lobby` row (the close call goes out only on a real leave).

function setup(phase: RoomState["phase"], seated: RaceDesk[]) {
  const clock = createFakeClock(1_000_000);
  const scheduler = createFakeScheduler(clock);
  const open = new Map<string, number>();
  const room: RoomState = {
    code: "KGB-4821",
    hostUserId: "host",
    phase,
    settings: DEFAULT_RACE_SETTINGS,
    race: null,
    endAt: null,
    seated,
    desks: null,
    raceId: null,
    endReason: null,
  };
  const lastLeave = createLastLeave({
    registry: {
      room: async () => room,
      withRoom: <T>(_lobbyId: string, fn: () => Promise<T>) => fn(),
    },
    scheduler,
    sockets: (lobbyId, userId) => open.get(`${lobbyId}/${userId}`) ?? 0,
  });
  const leave = vi.fn(async () => {});
  return { clock, scheduler, open, lastLeave, leave };
}

const host: RaceDesk = { desk: 1, userId: "host", name: "Ada", isBot: false };
const guest: RaceDesk = { desk: 2, userId: "b", name: "Bob", isBot: false };
const bot: RaceDesk = { desk: 3, userId: null, name: "Bot", isBot: true };

describe("last leave grace (#734)", () => {
  it("is a few seconds: longer than a reload, inside the 10 s the close is allowed", () => {
    expect(LAST_LEAVE_GRACE_MS).toBeGreaterThanOrEqual(3_000);
    expect(LAST_LEAVE_GRACE_MS).toBeLessThanOrEqual(6_000);
  });

  it("only the last human of a waiting room closes it (bots do not count)", async () => {
    expect(await setup("waiting", [host, bot]).lastLeave.closes("lob", "host")).toBe(true);
    expect(await setup("waiting", [host, guest]).lastLeave.closes("lob", "host")).toBe(false);
    expect(await setup("waiting", [guest]).lastLeave.closes("lob", "host")).toBe(false);
    expect(await setup("ended", [host]).lastLeave.closes("lob", "host")).toBe(false);
    expect(await setup("running", [host]).lastLeave.closes("lob", "host")).toBe(false);
  });

  it("host reload does not close: back within the grace, the leave never runs", () => {
    const { clock, open, lastLeave, leave } = setup("waiting", [host]);
    lastLeave.defer("lob", "host", leave);
    clock.advance(1_500);
    open.set("lob/host", 1); // the reloaded page's socket joined again
    clock.advance(LAST_LEAVE_GRACE_MS);
    expect(leave).not.toHaveBeenCalled();
  });

  it("a host who stays gone leaves once the grace runs out, not before", () => {
    const { clock, lastLeave, leave } = setup("waiting", [host]);
    lastLeave.defer("lob", "host", leave);
    clock.advance(LAST_LEAVE_GRACE_MS - 1);
    expect(leave).not.toHaveBeenCalled();
    clock.advance(1);
    expect(leave).toHaveBeenCalledOnce();
  });

  it("a second defer restarts the grace; close cancels every pending leave", () => {
    const { clock, scheduler, lastLeave, leave } = setup("waiting", [host]);
    lastLeave.defer("lob", "host", leave);
    clock.advance(4_000);
    lastLeave.defer("lob", "host", leave);
    clock.advance(4_000);
    expect(leave).not.toHaveBeenCalled();
    lastLeave.close();
    clock.advance(LAST_LEAVE_GRACE_MS);
    expect(leave).not.toHaveBeenCalled();
    expect(scheduler.armed()).toBe(0);
  });
});
