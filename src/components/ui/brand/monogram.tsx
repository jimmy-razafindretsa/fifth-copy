import { Mark } from "./mark";

export type MonogramVariant = "paper" | "red" | "ink";

export type MonogramProps = {
  /** The tile (docs/design/logo.md Assets): paper with ink border, red, or ink. */
  variant: MonogramVariant;
  /** Accessible name (the svg's `<title>`). */
  title: string;
  /** Square size in px, 16 to 512, clear space included (default 32). */
  size?: number;
  /** One bar height of padding on every side (docs/design/logo.md "Clear space"); default true. */
  clearSpace?: boolean;
  className?: string;
};

/** The FC monogram (design bible 5.2): the file of its tile, inline, square at any size down to 16 px. */
export function Monogram({
  variant,
  title,
  size = 32,
  clearSpace = true,
  className,
}: MonogramProps) {
  return (
    <Mark
      kind="monogram"
      name={`monogram-${variant}`}
      title={title}
      width={size}
      height={size}
      clearSpace={clearSpace}
      className={className}
    />
  );
}
