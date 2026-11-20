import { describe, expect, it } from "vitest";
import { detectOs, parseOs } from "./os";

// #999 C26: the OS is detected from the request; anything else is the unknown-OS fallback.
const UA = {
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
  chromeos:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
};

describe("detectOs (#999 C26)", () => {
  it("reads the User-Agent", () => {
    expect(detectOs(UA.windows, null)).toBe("windows");
    expect(detectOs(UA.mac, null)).toBe("mac");
    expect(detectOs(UA.chromeos, null)).toBe("chromeos");
  });

  it("falls back to the platform client hint", () => {
    expect(detectOs(UA.linux, '"Chrome OS"')).toBe("chromeos");
    expect(detectOs(UA.linux, '"Windows"')).toBe("windows");
    expect(detectOs(UA.linux, '"macOS"')).toBe("mac");
  });

  it("anything else is unknown", () => {
    expect(detectOs(UA.linux, '"Linux"')).toBeNull();
    expect(detectOs(UA.ipad, null)).toBeNull();
    expect(detectOs(null, null)).toBeNull();
  });

  it("an override must be a known OS", () => {
    expect(parseOs("mac")).toBe("mac");
    expect(parseOs("linux")).toBeNull();
    expect(parseOs(["mac"])).toBeNull();
  });
});
