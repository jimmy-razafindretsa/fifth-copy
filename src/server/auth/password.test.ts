import { describe, expect, it } from "vitest";
import { hashPassword, MAX_PASSWORD_LENGTH, PasswordError, verifyPassword } from "./password";

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

describe("hashPassword (C3)", () => {
  it("returns an Argon2id PHC string with at least the OWASP minimum cost", async () => {
    const match = PHC.exec(await hashPassword("correct horse"));
    expect(match).not.toBeNull();
    const [, m, t, p] = match!.map(Number);
    expect(m).toBeGreaterThanOrEqual(19456);
    expect(t).toBeGreaterThanOrEqual(2);
    expect(p).toBe(1);
  });

  it("salts every hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
  });
});

describe("verifyPassword (C3)", () => {
  it("is true only for the password that was hashed", async () => {
    const hash = await hashPassword("correct horse");
    await expect(verifyPassword("correct horse", hash)).resolves.toBe(true);
    await expect(verifyPassword("correct horsE", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it.each([
    ["empty", ""],
    ["not a PHC string", "plain-text"],
    ["truncated", "$argon2id$v=19$m=19456,t=2,p=1$abc"],
    ["unknown algorithm", "$bcrypt$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g"],
  ])("is false and never throws for a malformed hash (%s)", async (_, hash) => {
    await expect(verifyPassword("correct horse", hash)).resolves.toBe(false);
  });
});

describe("no secret leaks (C6)", () => {
  it("rejects an over-long password with an error that carries neither the password nor a hash", async () => {
    const secret = "hunter2-secret-";
    const plain = secret.repeat(Math.ceil((MAX_PASSWORD_LENGTH + 1) / secret.length));
    const error: unknown = await hashPassword(plain).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PasswordError);
    for (const text of [(error as Error).message, JSON.stringify(error), String(error)]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain("$argon2");
    }
  });

  it("verifies an over-long password as false without hashing it", async () => {
    const hash = await hashPassword("short");
    await expect(verifyPassword("x".repeat(MAX_PASSWORD_LENGTH + 1), hash)).resolves.toBe(false);
  });
});
