# Logo usage guide

The one place for the FIFTH COPY logo rules (art direction section 8, spec 3.4, R33). Components (#24) copy these facts; `components.md` only links here. The facts below are checked against the files by `src/components/ui/brand/assets.test.ts`.

**Provenance.** The logo is the Fifth Copy team's own design, not AI-generated (team confirmation 2026-10-04). The source of truth is page 8 of `docs/spec/art-direction.pdf`; the files in `public/brand/` are extracted from it by `scripts/brand/extract_logo.py`, never redrawn, traced or "cleaned up". Details and the regeneration command: [`public/brand/README.md`](../../public/brand/README.md).

## Assets

Every file is pure vector (`svg` > `title` + `path` only). Wordmarks have a transparent ground; monograms carry their own tile. The bar height is measured from the bar polygon of each SVG (the only 5-point `M...L...` path): the length of its vertical right edge, from point 2 to point 3, in viewBox units.

| File | Variant | Ground or tile | FIFTH/F | Bar | COPY/C | viewBox | Bar height |
|---|---|---|---|---|---|---|---|
| `public/brand/wordmark-red-on-paper.svg` | wordmark, default | paper `#F1E8D6` (transparent) | ink `#2A2420` | red `#B81D24` | paper `#F1E8D6` | `106.13 132.24 217.01 86.81` | 38.81 |
| `public/brand/wordmark-ink-on-red.svg` | wordmark on red | red `#B81D24` (transparent) | paper `#F1E8D6` | ink `#2A2420` | paper `#F1E8D6` | `472.5 132.24 216.83 86.81` | 38.81 |
| `public/brand/wordmark-red-on-ink.svg` | wordmark on ink or night | ink `#2A2420` (transparent) | paper `#F1E8D6` | red `#B81D24` | paper `#F1E8D6` | `106.13 267.7 217.01 86.81` | 38.80 |
| `public/brand/wordmark-tagline-red-on-paper.svg` | wordmark with tagline | paper `#F1E8D6` (transparent) | ink `#2A2420` | red `#B81D24` | paper `#F1E8D6` | `491.71 264.73 177.87 91.82` | 31.75 |
| `public/brand/monogram-paper.svg` | monogram, light | paper `#F1E8D6` tile, ink `#2A2420` border | ink `#2A2420` | red `#B81D24` | paper `#F1E8D6` | `26.81 400.9 79.02 79.02` | 24.69 |
| `public/brand/monogram-red.svg` | monogram, red tile | red `#B81D24` | paper `#F1E8D6` | ink `#2A2420` | red `#B81D24` | `111.48 413.25 54.33 54.33` | 16.93 |
| `public/brand/monogram-ink.svg` | monogram, ink tile | ink `#2A2420` | paper `#F1E8D6` | red `#B81D24` | ink `#2A2420` | `174.27 412.9 55.03 55.03` | 16.93 |

COPY and C are drawn in the ground colour over the bar (as in the PDF), never cut out of it. The bar slants up at 8.0 degrees in every file.

## Variants per background

| Ground | Use | Reads as |
|---|---|---|
| paper | `wordmark-red-on-paper` | ink FIFTH, red bar |
| red | `wordmark-ink-on-red` | paper FIFTH, ink bar |
| ink or night surface | `wordmark-red-on-ink` | paper FIFTH, red bar |
| any | a monogram | it carries its own tile |

The dark ground is ink `#2A2420`. On the Night shift theme the `wordmark-red-on-ink` mark is used, placed on an ink plate, never directly on a Night shift ground (bible 3.2). Any other wordmark ground is forbidden.

## Clear space

Keep one bar height of empty space on every side of the mark, measured at the rendered size (scale the value by rendered width / viewBox width). Values in viewBox units:

| Asset | Clear space |
|---|---|
| `wordmark-red-on-paper` | 38.81 |
| `wordmark-ink-on-red` | 38.81 |
| `wordmark-red-on-ink` | 38.80 |
| `wordmark-tagline-red-on-paper` | 31.75 |
| `monogram-paper` | 24.69 |
| `monogram-red` | 16.93 |
| `monogram-ink` | 16.93 |

Example: `wordmark-red-on-paper` rendered 240 px wide needs 38.81 x 240 / 217.01 = 43 px on every side.

## Tagline

"TYPE FAST · TYPE FIRST" appears only through `wordmark-tagline-red-on-paper`, only when the rendered wordmark is at least 240 px wide, and never with the monogram. Below 240 px use the plain wordmark.

## Forbidden

- A violet or gold bar (or any recolour of the bar beyond the variants above).
- A Night shift ground (`#3E3934`, `#4B453E`) as a wordmark ground.
- A straightened bar (the slant is always 8 degrees).
- Outlines or strokes around letters, bar or tile.
- Drop shadows, glows or any effect.
- Recoloured letters.
- Stretching or squashing: always scale both axes together.
- Knocking COPY or C out of the bar (they are drawn over it).
- Redrawing, retracing or "cleaning up" the marks, or adding any other logo file to the repository.
