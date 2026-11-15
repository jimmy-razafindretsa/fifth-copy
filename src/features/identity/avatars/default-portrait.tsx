// The default stamped portrait (#60, bible 10.1 "toy-sized bureaucracy", 3, 18): a rubber-stamp ID
// picture in one ink on one ground: a flat silhouette (#951: no face, it read as a clown at 32 px), big
// head, an oversized cap from the 10.1 hat catalogue, a collar notch. Pure: the variant (cap + ground) is hash(seed) mod 4, so a user keeps
// the same portrait everywhere. Colours are token roles only (bible 3; scripts/check-colours.ts).

/** FNV-1a 32-bit: small, stable across runtimes, good enough to spread ids over four variants. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type PortraitVariant = 0 | 1 | 2 | 3;

export function portraitVariant(seed: string): PortraitVariant {
  return (hash(seed) % 4) as PortraitVariant;
}

/** Ground and ink per variant: the ink plate (band) prints paper; the paper grounds print ink. */
const PLATES: Record<PortraitVariant, { ground: string; ink: string }> = {
  0: { ground: "var(--color-surface)", ink: "var(--color-fg)" },
  1: { ground: "var(--color-band)", ink: "var(--color-band-fg)" },
  2: { ground: "var(--color-bg)", ink: "var(--color-fg)" },
  3: { ground: "var(--color-surface-muted)", ink: "var(--color-fg)" },
};

/**
 * The four caps of 10.1, drawn oversized over the head: kepka, ushanka, eyeshade, beret. Each is ruled
 * off from the ink head by a ground-coloured outline, so the silhouette reads at 32 px (#951).
 */
function Cap({ variant, ink, ground }: { variant: PortraitVariant; ink: string; ground: string }) {
  const rule = { stroke: ground, strokeWidth: 2.5, strokeLinejoin: "round" as const };
  switch (variant) {
    case 0: // kepka: a flat cap with a long peak to the right
      return <path d="M17 24C17 10 46 9 47 20L56 24L17 26Z" fill={ink} {...rule} />;
    case 1: // ushanka: a fur dome with ear flaps
      return (
        <path
          d="M18 23C18 9 46 9 46 23H49V36H43V27H21V36H15V23Z"
          fill={ink}
          {...rule}
        />
      );
    case 2: // eyeshade: a band and a wide visor
      return <path d="M20 16H44V21H52L45 27H19L12 21H20Z" fill={ink} {...rule} />;
    default: // beret: a wide tilted disc with its nub
      return (
        <g fill={ink} {...rule}>
          <rect x="30" y="8" width="3" height="6" />
          <ellipse cx="31" cy="20" rx="18" ry="7" transform="rotate(-8 31 20)" />
        </g>
      );
  }
}

export function DefaultPortrait({
  seed,
  size,
  label,
  className,
}: {
  seed: string;
  size: number;
  /** The accessible name (the typist name); without one the portrait is decorative. */
  label?: string;
  className?: string;
}) {
  const variant = portraitVariant(seed);
  const { ground, ink } = PLATES[variant];
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      data-avatar="portrait"
      data-variant={variant}
      {...a11y}
    >
      <rect
        x="1"
        y="1"
        width="62"
        height="62"
        fill={ground}
        stroke="var(--color-fg)"
        strokeWidth="2"
      />
      {/* a clean stamped silhouette: shoulders with the collar notch, the neck, the big head */}
      <path d="M9 63C9 51 19 45 32 45C45 45 55 51 55 63Z" fill={ink} />
      <path d="M26 45L32 53L38 45Z" fill={ground} />
      <rect x="28" y="38" width="8" height="8" fill={ink} />
      <circle cx="32" cy="30" r="12" fill={ink} />
      <Cap variant={variant} ink={ink} ground={ground} />
    </svg>
  );
}
