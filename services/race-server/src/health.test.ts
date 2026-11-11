import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { createHealthHandler, healthBody } from "./health";

describe("race-server health", () => {
  it("reports ok while not draining and carries engine and protocol versions", () => {
    const body = healthBody({ rooms: 2, draining: false });
    expect(body.ok).toBe(true);
    expect(body.rooms).toBe(2);
    expect(body.engine).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.protocol).toBeGreaterThan(0);
  });
  it("names the commit it runs (#718 C2): Railway's commit when given, null otherwise", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(healthBody({ rooms: 0, draining: false, commit: sha }).commit).toBe(sha);
    expect(healthBody({ rooms: 0, draining: false, commit: null }).commit).toBeNull();
    expect(healthBody({ rooms: 0, draining: false }).commit).toBeNull();
  });
  it("reports not ok while draining so the load balancer stops sending new rooms", () => {
    expect(healthBody({ rooms: 0, draining: true }).ok).toBe(false);
  });
});

describe("race-server health handler (C7)", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  async function boot(source: {
    rooms: () => number;
    draining: () => boolean;
    commit?: string | null;
  }) {
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

  it("#718 C2 adds commit beside protocol, engine, rooms and draining; status codes unchanged", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const base = await boot({ rooms: () => 0, draining: () => false, commit: sha });
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["commit", "draining", "engine", "ok", "protocol", "rooms", "service"].sort(),
    );
    expect(body).toMatchObject({ commit: sha, protocol: PROTOCOL_VERSION, ok: true });
  });
});
