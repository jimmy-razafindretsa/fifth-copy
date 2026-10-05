# Brand assets

Final FIFTH COPY logo, as pure vectors: `path` elements only, with no `text`, no raster and no font dependency.

**Provenance.** The logo was designed by the Fifth Copy team and is **not AI-generated** (team confirmation, 2026-10-04; the brief forbids AI for the name and logo, spec §3.4). The source of truth is page 8 of [`docs/spec/art-direction.pdf`](../../docs/spec/art-direction.pdf). These files are a lossless extraction of that page by `scripts/brand/extract_logo.py`: bars and tiles are the page's own vector drawings, and letters are the outlines of the embedded Stardos Stencil Bold glyphs at their exact positions. Nothing was redrawn or traced. The COPY bar slants up at 8.0° (glyph direction 0.990, -0.139).

| File | Use | Colours |
|---|---|---|
| `wordmark-red-on-paper.svg` | default, on paper `#F1E8D6` | ink `#2A2420` FIFTH, red `#B81D24` bar, paper COPY |
| `wordmark-ink-on-red.svg` | on red `#B81D24` | paper FIFTH, ink bar, paper COPY |
| `wordmark-red-on-ink.svg` | on ink `#2A2420` or night | paper FIFTH, red bar, paper COPY |
| `wordmark-tagline-red-on-paper.svg` | with "TYPE FAST · TYPE FIRST", only when there is room | as red-on-paper |
| `monogram-paper.svg` | app icon / favicon, light | paper tile with ink border, red bar |
| `monogram-red.svg` | app icon, red tile | ink bar, red C |
| `monogram-ink.svg` | app icon, ink tile | red bar, ink C |

Wordmarks have a transparent ground: place them on the ground their name says. Monograms carry their own tile. COPY and C are drawn in the ground colour over the bar, as in the PDF, rather than cut out of it.

Rules (art direction §8): never recolour the bar violet or gold, never straighten it, and keep clear space of one bar height around the mark.

Regenerate (needs Python with `pymupdf` and `fonttools`):

```bash
python scripts/brand/extract_logo.py docs/spec/art-direction.pdf public/brand
```
