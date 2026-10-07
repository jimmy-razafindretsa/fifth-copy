import { Mark, markRatio } from "./mark";

export type WordmarkVariant = "red-on-paper" | "ink-on-red" | "red-on-ink";

type Common = {
  /** Accessible name (the svg's `<title>`). */
  title: string;
  /** Rendered width of the svg in px, clear space included (default 240). */
  width?: number;
  /** One bar height of padding on every side (docs/design/logo.md "Clear space"); default true. */
  clearSpace?: boolean;
  className?: string;
};

export type WordmarkProps = Common &
  (
    | {
        variant: "red-on-paper";
        /** TYPE FAST · TYPE FIRST under the mark, only when it renders at least 240 px wide (logo.md). */
        tagline?: boolean;
      }
    | { variant: "ink-on-red" | "red-on-ink"; tagline?: false }
  );

/**
 * The FIFTH COPY wordmark (design bible 5.1, docs/design/logo.md): the file of its variant, inline, on a
 * transparent ground. Place it on the ground its variant names: paper, red, or ink (never Night shift).
 */
export function Wordmark({
  variant,
  tagline = false,
  title,
  width = 240,
  clearSpace = true,
  className,
}: WordmarkProps) {
  const name = tagline ? "wordmark-tagline-red-on-paper" : (`wordmark-${variant}` as const);
  return (
    <Mark
      kind="wordmark"
      name={name}
      title={title}
      width={width}
      height={width * markRatio(name, clearSpace)}
      clearSpace={clearSpace}
      className={className}
    />
  );
}
