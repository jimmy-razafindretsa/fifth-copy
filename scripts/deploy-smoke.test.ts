import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { type AddressInfo, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Async spawn, not spawnSync: a synchronous child blocks the event loop, so the in-process stub
// below would never answer and curl would time out with 000.
const runSmoke = (base: string, path = process.env.PATH ?? "") =>
  new Promise<{ status: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn("scripts/deploy-smoke.sh", [base], { env: { PATH: path } });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout }));
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
