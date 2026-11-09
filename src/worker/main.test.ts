import "dotenv/config";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { durationMs } from "./job";
import { jobs } from "./registry";
import type { Scheduler } from "./scheduler";

// #733 C3: the worker entry point. Unit half with a fake process and scheduler; the boot half spawns
// `npm run dev:worker` against the test database (ADR 0003).
vi.mock("@/env", () => ({ env: { NODE_ENV: "test", DATABASE_URL: "postgresql://unused/db" } }));
vi.mock("@/server/db", () => ({ db: {} }));

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const ROOT = path.resolve(__dirname, "../..");
const silent = { info: () => undefined, error: () => undefined };

class FakeProcess extends EventEmitter {
  exits: number[] = [];
  exit = (code: number) => void this.exits.push(code);
}

describe("worker registry", () => {
  it("registers heartbeat every 5 minutes", () => {
    const hb = jobs.find((j) => j.name === "heartbeat");
    expect(hb).toBeDefined();
    expect(durationMs(hb!.every)).toBe(5 * 60 * 1000);
    expect(new Set(jobs.map((j) => j.name)).size).toBe(jobs.length);
  });
});

describe("runWorker", () => {
  it("starts the scheduler, and on SIGTERM finishes the running job, closes, then exits 0", async () => {
    const { runWorker } = await import("./main");
    let finishJob!: () => void;
    const jobDone = new Promise<void>((r) => (finishJob = r));
    const order: string[] = [];
    const scheduler: Scheduler = {
      tick: async () => undefined,
      start: () => void order.push("start"),
      stop: async () => {
        order.push("stop");
        await jobDone; // the running job
        order.push("job finished");
      },
    };
    const proc = new FakeProcess();
    runWorker({
      scheduler,
      proc,
      close: async () => void order.push("close"),
      log: silent,
    });
    expect(order).toEqual(["start"]);

    proc.emit("SIGTERM");
    proc.emit("SIGTERM"); // a second signal does not stop twice
    await new Promise((r) => setTimeout(r, 20));
    expect(proc.exits).toEqual([]);

    finishJob();
    await vi.waitFor(() => expect(proc.exits).toEqual([0]));
    expect(order).toEqual(["start", "stop", "job finished", "close"]);
  });

  it("exposes nothing on the network: no worker module imports a server or socket API", () => {
    const dir = path.join(ROOT, "src/worker");
    const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(sources).toContain("main.ts");
    for (const file of sources) {
      const text = readFileSync(path.join(dir, file), "utf8");
      expect(text, file).not.toMatch(/from "(node:)?(http|https|http2|net|dgram|tls)"/);
      expect(text, file).not.toMatch(/\.listen\(|createServer/);
    }
  });
});

describe.skipIf(!testDatabaseUrl)("npm run dev:worker (needs TEST_DATABASE_URL)", () => {
  it("loads env, writes a heartbeat JobRun, and exits 0 on SIGTERM", async () => {
    const db = createPrismaClient(testDatabaseUrl!);
    try {
      await db.jobRun.deleteMany({ where: { name: "heartbeat" } });
      const t0 = new Date();
      // The exact `dev:worker` script, exec'd so SIGTERM reaches tsx and the worker, not npm.
      const script = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts[
        "dev:worker"
      ];
      const child = spawn("sh", ["-c", `exec ${script}`], {
        cwd: ROOT,
        env: {
          PATH: `${path.join(ROOT, "node_modules/.bin")}:${process.env.PATH}`, // eslint-disable-line no-restricted-properties
          HOME: process.env.HOME, // eslint-disable-line no-restricted-properties
          NODE_ENV: "test",
          DATABASE_URL: testDatabaseUrl,
          AUTH_SECRET: "a".repeat(32),
          RACE_TOKEN_SECRET: "r".repeat(32),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));

      await vi.waitFor(() => expect(out).toContain('"msg":"worker: job ok"'), {
        timeout: 30_000,
        interval: 100,
      });
      child.kill("SIGTERM");
      expect(await exited).toBe(0);
      expect(out).toContain('"msg":"worker: stopped"');

      const rows = await db.jobRun.findMany({
        where: { name: "heartbeat", startedAt: { gte: t0 } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("OK");
    } finally {
      await db.$disconnect();
    }
  }, 60_000);
});
