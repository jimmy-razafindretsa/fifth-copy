import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Device as FromIndex } from "@/components/ui";
import { DEVICE_TONES, Device } from "./device";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("Device (#25 C5)", () => {
  it("is exported from the ui index", () => {
    expect(FromIndex).toBe(Device);
  });

  it("maps each tone to its scoped glow utility", () => {
    expect(DEVICE_TONES).toEqual({ phosphor: "device-phosphor", nixie: "device-nixie" });
    expect(html(<Device tone="nixie">00 88 66</Device>)).toContain("device-nixie");
    expect(html(<Device tone="nixie">00 88 66</Device>)).not.toContain("device-phosphor");
    expect(html(<Device tone="phosphor">READY</Device>)).toContain("device-phosphor");
  });

  it("is a bezel: data-device, room frame, device-bezel interior", () => {
    const out = html(<Device tone="phosphor">READY</Device>);
    expect(out).toMatch(/^<div[^>]*data-device="phosphor"/);
    expect(out).toContain("border-room");
    expect(out).toContain("bg-device-bezel");
    expect(out).toContain("READY");
  });

  it("keeps a caller class", () => {
    expect(
      html(
        <Device tone="nixie" className="text-2xl">
          00
        </Device>,
      ),
    ).toContain("text-2xl");
  });
});
