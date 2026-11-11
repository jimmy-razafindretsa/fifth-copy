import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clientAcks, clientEvents, PROTOCOL_VERSION, rejectReasonSchema, serverEvents } from "./index";

/**
 * The README is the wire's prose map (#898): five version bumps updated it piecemeal and it drifted
 * from the code. These checks fail when a wire name the code declares is missing from it.
 */
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const internalSource = readFileSync(new URL("./internal.ts", import.meta.url), "utf8");

/** Each internal route as `internal.ts` names it in its schemas' doc comments. */
const internalRoutes = [...new Set([...internalSource.matchAll(/`POST (\/[^`\s]+)`/g)].map((m) => m[1]!))];

describe("packages/protocol/README.md (#898)", () => {
  it("states the current PROTOCOL_VERSION", () => {
    const stated = /`PROTOCOL_VERSION`, now (\d+)/.exec(readme);
    expect(stated?.[1]).toBe(String(PROTOCOL_VERSION));
  });

  it.each(Object.keys(serverEvents))("documents the server event `%s` with its payload", (key) => {
    expect(readme).toContain(`\`${key} {`);
  });

  it.each(Object.keys(clientEvents))("documents the client event `%s` with its payload", (key) => {
    expect(readme).toContain(`\`${key} {`);
  });

  it.each(Object.keys(clientAcks))("documents the ack of `%s`", (key) => {
    const line = readme.split("\n").find((l) => l.includes(`\`${key} {`));
    expect(line).toMatch(/\back\b/);
  });

  it("names every handshake reject reason on the refusal line", () => {
    const line = readme.split("\n").find((l) => l.includes("`rejectReasonSchema`")) ?? "";
    for (const reason of rejectReasonSchema.options) expect(line).toContain(`\`${reason}\``);
  });

  it("names every internal route declared in internal.ts", () => {
    expect(internalRoutes.length).toBeGreaterThanOrEqual(8);
    for (const route of internalRoutes) expect(readme).toContain(`\`POST ${route}\``);
  });
});
