import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { type AddressInfo, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Async spawn, not spawnSync: a synchronous child blocks the event loop, so the in-process stub
// below would never answer and curl would time out with 000.
// The child carries its own deadline (#600), below the slow project's per-test timeout
// (vitest.config.ts): a hung script is killed and fails its test with that reason.
const SPAWN_TIMEOUT = 30_000;
const runSmoke = (
  base: string,
  path = process.env.PATH ?? "",
  extra: Record<string, string> = {},
) =>
  new Promise<{ status: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn("scripts/deploy-smoke.sh", [base], {
      env: { NODE_ENV: "test", PATH: path, ...extra },
      timeout: SPAWN_TIMEOUT,
    });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.on("error", reject);
    child.on("close", (status, signal) =>
      signal
        ? reject(new Error(`deploy-smoke.sh killed by ${signal} (timeout ${SPAWN_TIMEOUT} ms)`))
        : resolve({ status, stdout }),
    );
  });

const lastLine = (out: string) => out.trimEnd().split("\n").at(-1);
const count = (out: string, needle: string) => out.split(needle).length - 1;

let healthBody = '{"ok":true}';
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" }).end(healthBody);
    } else if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html>");
    } else {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  healthBody = '{"ok":true}';
});

describe("deploy-smoke", () => {
  it("passes all probes against a healthy host", async () => {
    const r = await runSmoke(base);
    expect(r.status).toBe(0);
    expect(count(r.stdout, "PASS ")).toBe(3);
    expect(lastLine(r.stdout)).toBe(`smoke: ok (${base})`);
  });

  it("fails when /api/health does not report ok", async () => {
    healthBody = '{"ok":false}';
    const r = await runSmoke(base);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`FAIL health: GET /api/health body missing '"ok":true'`);
    expect(lastLine(r.stdout)).toBe(`smoke: FAILED (${base})`);
  });

  it("prints 000 once per probe for an unreachable host", async () => {
    const probe = createNetServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const dead = `http://127.0.0.1:${port}`;

    const r = await runSmoke(dead);
    expect(r.status).toBe(1);
    expect(count(r.stdout, "-> 000 (want")).toBe(3);
    expect(r.stdout).not.toContain("000000");
    expect(lastLine(r.stdout)).toBe(`smoke: FAILED (${dead})`);
  });

  it("falls back to 000 when curl prints nothing", async () => {
    const bin = mkdtempSync(join(tmpdir(), "smoke-curl-"));
    try {
      const curl = join(bin, "curl");
      writeFileSync(curl, "#!/bin/sh\nexit 7\n");
      chmodSync(curl, 0o755);
      const r = await runSmoke(base, `${bin}:${process.env.PATH ?? ""}`);
      expect(r.status).toBe(1);
      expect(count(r.stdout, "-> 000 (want")).toBe(3);
      expect(lastLine(r.stdout)).toBe(`smoke: FAILED (${base})`);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

// Card #423 C1: with RACE_SMOKE_URL set the script also probes the race server's /health (200 and
// "ok":true); unset, it keeps its three web probes. A draining race server answers 503 (#704).
describe("deploy-smoke race-server probe (card #423)", () => {
  let raceStatus = 200;
  let raceBody = '{"ok":true}';
  let race: Server;
  let raceBase: string;

  beforeAll(async () => {
    race = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(raceStatus, { "content-type": "application/json" }).end(raceBody);
      } else res.writeHead(404).end("not found");
    });
    await new Promise<void>((resolve) => race.listen(0, "127.0.0.1", resolve));
    raceBase = `http://127.0.0.1:${(race.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    race.closeAllConnections();
    await new Promise<void>((resolve) => race.close(() => resolve()));
  });

  beforeEach(() => {
    raceStatus = 200;
    raceBody = '{"ok":true}';
  });

  const withRace = (url: string) => runSmoke(base, undefined, { RACE_SMOKE_URL: url });

  it("C1 unset: only the three web probes run", async () => {
    const r = await runSmoke(base);
    expect(r.stdout).not.toContain("race-health");
    expect(count(r.stdout, "PASS ")).toBe(3);
  });

  it("C1 set and healthy: the race-server /health probe passes", async () => {
    const r = await withRace(`${raceBase}/`);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("PASS race-health: GET /health -> 200");
    expect(count(r.stdout, "PASS ")).toBe(4);
  });

  it("C1 a draining race server (503) fails the run", async () => {
    raceStatus = 503;
    raceBody = '{"ok":false,"draining":true}';
    const r = await withRace(raceBase);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAIL race-health: GET /health -> 503 (want 200)");
    expect(lastLine(r.stdout)).toBe(`smoke: FAILED (${base})`);
  });

  it('C1 a 200 without "ok":true fails the run', async () => {
    raceBody = '{"ok":false}';
    const r = await withRace(raceBase);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`FAIL race-health: GET /health body missing '"ok":true'`);
  });

  it("C1 an unreachable race server fails with 000", async () => {
    const probe = createNetServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const r = await withRace(`http://127.0.0.1:${port}`);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAIL race-health: GET /health -> 000 (want 200)");
  });
});
