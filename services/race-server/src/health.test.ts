import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createHealthHandler, healthBody } from "./health";

describe("race-server health", () => {
  it("reports ok while not draining and carries engine and protocol versions", () => {
    const body = healthBody({ rooms: 2, draining: false });
    expect(body.ok).toBe(true);
    expect(body.rooms).toBe(2);
    expect(body.engine).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.protocol).toBeGreaterThan(0);
  });
  it("reports not ok while draining so the load balancer stops sending new rooms", () => {
    expect(healthBody({ rooms: 0, draining: true }).ok).toBe(false);
  });
});

describe("race-server health handler (C7)", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  async function boot(source: { rooms: () => number; draining: () => boolean }) {
    server = createServer(createHealthHandler(source));
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("reports rooms from the live source on every request", async () => {
    let rooms = 30;
    const base = await boot({ rooms: () => rooms, draining: () => false });
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, rooms: 30, draining: false });
    rooms = 29;
    expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ rooms: 29 });
  });

  it("answers 503 while draining and 404 elsewhere", async () => {
    const base = await boot({ rooms: () => 1, draining: () => true });
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, rooms: 1, draining: true });
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
