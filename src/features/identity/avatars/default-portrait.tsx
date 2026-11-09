// The default stamped portrait (#60, bible 10.1 "toy-sized bureaucracy", 3, 18): a rubber-stamp ID
// picture in one ink on one ground. Big head sunk into the shoulders, an oversized cap from the 10.1
// hat catalogue, a shirt collar. Pure: the variant (cap + ground) is hash(seed) mod 4, so a user keeps
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

/** The four caps of 10.1, drawn oversized: kepka, ushanka, eyeshade, beret. */
function Cap({ variant, ink, ground }: { variant: PortraitVariant; ink: string; ground: string }) {
  switch (variant) {
    case 0: // kepka: a flat cap with a long peak to the right
      return <path d="M14 27C14 11 48 10 50 22L57 26L14 28Z" fill={ink} />;
    case 1: // ushanka: a fur dome with ear flaps
      return (
        <g fill={ink}>
          <path d="M15 25C15 8 49 8 49 25Z" />
          <rect x="12" y="22" width="40" height="6" />
          <rect x="12" y="26" width="7" height="13" />
          <rect x="45" y="26" width="7" height="13" />
        </g>
      );
    case 2: // eyeshade: a band and a wide visor
      return (
        <g fill={ink}>
          <rect x="17" y="17" width="30" height="6" />
          <path d="M11 23H53L46 29H18Z" />
        </g>
      );
    default: // beret: a wide tilted disc with its nub
      return (
        <g fill={ink}>
          <ellipse cx="29" cy="20" rx="21" ry="8" transform="rotate(-8 29 20)" />
          <rect x="27" y="9" width="3" height="5" />
          <path d="M17 24H45" stroke={ground} strokeWidth="1.5" />
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
      {/* shoulders and the open shirt collar */}
      <path d="M8 63C8 50 19 44 32 44C45 44 56 50 56 63Z" fill={ink} />
      <path
        d="M24 44L32 55L40 44Z"
        fill={ground}
        stroke={ink}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* the big head, sunk into the shoulders */}
      <circle cx="32" cy="31" r="15" fill={ground} stroke={ink} strokeWidth="2.5" />
      <circle cx="26.5" cy="31" r="2" fill={ink} />
      <circle cx="37.5" cy="31" r="2" fill={ink} />
      <circle cx="32" cy="36" r="2.4" fill={ink} />
      <path
        d="M27 40.5Q32 43 37 40.5"
        fill="none"
        stroke={ink}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <Cap variant={variant} ink={ink} ground={ground} />
    </svg>
  );
}
