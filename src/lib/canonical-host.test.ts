import { describe, expect, it } from "vitest";
import { apexRedirect, requestHost } from "./canonical-host";

// #951: the bare domain goes to www (308, path and query kept); nothing else ever redirects.
const APP = "https://www.fifthcopy.com";

describe("requestHost", () => {
  it("prefers x-forwarded-host, takes its first value, lowercases and strips the port", () => {
    expect(requestHost("FifthCopy.com:443", "localhost:8080")).toBe("fifthcopy.com");
    expect(requestHost("a.example, b.example", null)).toBe("a.example");
    expect(requestHost(null, "localhost:3000")).toBe("localhost");
    expect(requestHost(null, "[::1]:3000")).toBe("[::1]");
    expect(requestHost(null, null)).toBeNull();
  });
});

describe("apexRedirect", () => {
  it("sends the bare domain to the www origin with the path and query", () => {
    expect(apexRedirect("fifthcopy.com", APP, "/lobby/KGB-4821?x=1")).toBe(
      "https://www.fifthcopy.com/lobby/KGB-4821?x=1",
    );
    expect(apexRedirect("fifthcopy.com", APP, "/")).toBe("https://www.fifthcopy.com/");
  });

  it("ignores www itself, localhost, a railway host and any other host", () => {
    for (const host of [
      "www.fifthcopy.com",
      "localhost",
      "web-production.up.railway.app",
      "evil.com",
      "fifthcopy.com.evil.com",
    ])
      expect(apexRedirect(host, APP, "/"), host).toBeNull();
    expect(apexRedirect(null, APP, "/")).toBeNull();
  });

  it("never fires when the canonical host has no www (local, preview)", () => {
    expect(apexRedirect("localhost", "http://localhost:3000", "/")).toBeNull();
    expect(apexRedirect("up.railway.app", "https://web-production.up.railway.app", "/")).toBeNull();
    expect(apexRedirect("fifthcopy.com", "not a url", "/")).toBeNull();
  });

  it("works with a port taken off the request host", () => {
    expect(apexRedirect(requestHost("fifthcopy.com:443", null), APP, "/a")).toBe(
      "https://www.fifthcopy.com/a",
    );
  });
});
