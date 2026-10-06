import { describe, expect, it } from "vitest";
import { sniffImageType } from "./sniff";

const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat(
    parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))),
  );

describe("sniffImageType (magic bytes only)", () => {
  it.each([
    ["jpeg", bytes([0xff, 0xd8, 0xff, 0xe0], "rest")],
    ["png", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "IHDR")],
    ["gif", bytes("GIF89a", [1, 0, 1, 0])],
    ["gif", bytes("GIF87a", [1, 0, 1, 0])],
    ["webp", bytes("RIFF", [0x10, 0, 0, 0], "WEBPVP8 ")],
  ] as const)("C4: recognises %s", (type, input) => {
    expect(sniffImageType(input)).toBe(type);
  });

  it.each([
    ["svg", bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["heic", bytes([0, 0, 0, 0x18], "ftypheic", [0, 0, 0, 0])],
    ["html", bytes("<!doctype html><img src=x onerror=alert(1)>")],
    ["riff that is not webp (wav)", bytes("RIFF", [0x10, 0, 0, 0], "WAVEfmt ")],
    ["empty", Buffer.alloc(0)],
    ["truncated png signature", bytes([0x89, 0x50, 0x4e, 0x47])],
    ["polyglot with the jpeg magic late", bytes("<html>", [0xff, 0xd8, 0xff])],
  ])("C4: rejects %s", (_label, input) => {
    expect(sniffImageType(input)).toBeNull();
  });
});
