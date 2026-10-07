import { cn } from "@/lib/cn";
import { BRAND_MARKS, type BrandMarkName, type BrandRole } from "./assets";

// Literal class strings: Tailwind 4 only emits utilities it finds as complete strings.
const FILL: Record<BrandRole, string> = {
  primary: "fill-primary",
  band: "fill-band",
  "band-fg": "fill-band-fg",
};

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * The viewBox of a mark: the file's own, grown by one bar height on every side when `clearSpace`
 * (docs/design/logo.md "Clear space"), so the padding scales with the rendered size by construction.
 */
export function markViewBox(name: BrandMarkName, clearSpace: boolean): string {
  const { viewBox, clearSpace: c } = BRAND_MARKS[name];
  const [x, y, w, h] = viewBox;
  const box = clearSpace ? [x - c, y - c, w + 2 * c, h + 2 * c] : [x, y, w, h];
  return box.map(round).join(" ");
}

type MarkProps = {
  name: BrandMarkName;
  title: string;
  width: number;
  height: number;
  clearSpace: boolean;
  className?: string;
  kind: "wordmark" | "monogram";
};

/** One brand file as inline SVG: its paths verbatim, each filled through its role. */
export function Mark({ name, title, width, height, clearSpace, className, kind }: MarkProps) {
  const mark = BRAND_MARKS[name];
  return (
    <svg
      role="img"
      viewBox={markViewBox(name, clearSpace)}
      width={round(width)}
      height={round(height)}
      className={cn("block shrink-0", className)}
      data-brand={kind}
      data-mark={name}
      data-clear-space={clearSpace ? mark.clearSpace : 0}
    >
      <title>{title}</title>
      {mark.paths.map(({ fill, d }, i) => (
        <path key={i} className={FILL[fill]} d={d} />
      ))}
    </svg>
  );
}

/** Height over width of a mark's rendered box (with or without its clear space). */
export function markRatio(name: BrandMarkName, clearSpace: boolean): number {
  const [, , w, h] = markViewBox(name, clearSpace).split(" ").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return h / w;
}
