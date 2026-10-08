import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type DeviceTone = "phosphor" | "nixie";

// Literal class strings: the glow utilities (docs/design/tokens.css) light only inside [data-device].
export const DEVICE_TONES: Record<DeviceTone, string> = {
  phosphor: "device-phosphor",
  nixie: "device-nixie",
};

export type DeviceProps = {
  tone: DeviceTone;
  className?: string;
  children: ReactNode;
};

/**
 * A device bezel (design bible 0: glow lives only in CRT screens and nixie tubes): a `room` frame
 * around a `device-bezel` interior. The only place where the phosphor and nixie glow may appear.
 */
export function Device({ tone, className, children }: DeviceProps) {
  return (
    <div
      data-device={tone}
      className={cn(
        "inline-flex items-center gap-4 border-2 border-room bg-device-bezel px-4 py-3",
        DEVICE_TONES[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}
