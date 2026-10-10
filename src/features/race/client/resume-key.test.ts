import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearResumeKey,
  readResumeKey,
  RESUME_KEY_PREFIX,
  storeResumeKey,
} from "./resume-key";

// Contract of #561 C11: the desk's resume key lives in sessionStorage under
// `fifth-copy:resume:<lobbyId>`; every call survives a storage that is missing or throws, and reads
// `null` then. A stored value that is not a resume key (tampered, truncated) reads `null` too: sent in
// the handshake it would fail the protocol's auth parse and refuse the socket as `bad-token`.
const LOBBY = "cmuvut8r2000106r7wf01vr30";
const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void map.set(k, v)),
    removeItem: vi.fn((k: string) => void map.delete(k)),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("resume key storage (#561 C11)", () => {
  it("stores, reads and clears the key per lobby under fifth-copy:resume:<lobbyId>", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });
    expect(RESUME_KEY_PREFIX).toBe("fifth-copy:resume:");

    expect(readResumeKey(LOBBY)).toBeNull();
    storeResumeKey(LOBBY, KEY);
    expect([...storage.map.entries()]).toEqual([[`fifth-copy:resume:${LOBBY}`, KEY]]);
    expect(readResumeKey(LOBBY)).toBe(KEY);
    expect(readResumeKey("cmuvumv5q002f0fr7b6mgzfcf")).toBeNull();

    clearResumeKey(LOBBY);
    expect(storage.map.size).toBe(0);
    expect(readResumeKey(LOBBY)).toBeNull();
  });

  it("reads null for a stored value that is not a resume key", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });
    for (const bad of ["short", `${KEY}${KEY}`, "x".repeat(31), `${"a".repeat(40)}!`, ""]) {
      storage.map.set(`fifth-copy:resume:${LOBBY}`, bad);
      expect(readResumeKey(LOBBY), bad).toBeNull();
    }
  });

  it("never stores a value that is not a resume key", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });
    storeResumeKey(LOBBY, "not a key");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("no window (server render, tests): every call is a no-op and reads null", () => {
    vi.stubGlobal("window", undefined);
    expect(() => storeResumeKey(LOBBY, KEY)).not.toThrow();
    expect(readResumeKey(LOBBY)).toBeNull();
    expect(() => clearResumeKey(LOBBY)).not.toThrow();
  });

  it("blocked site data (the sessionStorage getter throws): no-ops and null", () => {
    const blocked = {};
    Object.defineProperty(blocked, "sessionStorage", {
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    vi.stubGlobal("window", blocked);
    expect(() => storeResumeKey(LOBBY, KEY)).not.toThrow();
    expect(readResumeKey(LOBBY)).toBeNull();
    expect(() => clearResumeKey(LOBBY)).not.toThrow();
  });

  it("a storage whose calls throw (quota, private mode): no-ops and null", () => {
    const fail = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    vi.stubGlobal("window", {
      sessionStorage: { getItem: vi.fn(fail), setItem: vi.fn(fail), removeItem: vi.fn(fail) },
    });
    expect(() => storeResumeKey(LOBBY, KEY)).not.toThrow();
    expect(readResumeKey(LOBBY)).toBeNull();
    expect(() => clearResumeKey(LOBBY)).not.toThrow();
  });
});
