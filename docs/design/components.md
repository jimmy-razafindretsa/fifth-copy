# Component inventory (`src/components/ui`)

Status: starter primitives (#7) wearing the Fifth Copy palette and colour roles (#16, design bible section 3), the six brand fonts (#21) and the six type roles (#20: buttons and labels in Oswald, titles in Stardos Stencil, copy in Courier Prime), the printed look and the colour usage rules (#15), theme switching and the contrast audit of both themes (#19).
Living page: `/design` (`src/app/design/page.tsx`); tests: `e2e/design.spec.ts` (visual baselines tagged `@visual`).

## Rules
- Tokens only: `docs/design/tokens.css` is the single source. Tailwind's default palette is removed, so `bg-zinc-50` does not exist; use semantic utilities (`bg-surface`, `text-fg`, `text-fg-muted`, `border-border`, `bg-primary`, `text-danger`, ...). Spacing uses the Tailwind scale (`p-4`), no radius (`--radius-{sm,md,lg}` are 0, `rounded-full` only for the spinner and dots; "Printed look"), type through the six roles of "Type roles" below (`type-display-{sm,md,lg}`, `type-label`, `type-typing`, `type-flavour`, `type-body`, `type-device`), sizes `text-{xs..3xl}` only to resize a role. The bare faces `font-{display,label,typing,flavour,body,device}` exist for code samples only (`font-sans`/`font-mono` do not exist).
- Colours: brand values (`--brand-*`) are never used directly and are not utilities; use a role from the tables below (`bg-you`, `text-rival`, `bg-tape`, ...). Write class names as complete literals (`"bg-you"`, never `` `bg-${role}` ``): Tailwind only emits classes it finds as whole strings.
- Links: `text-link underline` in both themes.
- Themes: light by default, Night shift via `prefers-color-scheme` or `<html data-theme="dark">`. Never use `dark:` color overrides; the tokens switch. The choice is the `theme` cookie (values `light` and `dark`; absent = follow the OS), HttpOnly, SameSite=Lax, 1 year, written only by the `setTheme` server action (`system` deletes it); the root layout renders `data-theme` from it on the server, so the first paint is already in the chosen theme (ARCHITECTURE 8.4). The control is `ThemeToggle` in `src/features/preferences` (bible 14.1 NIGHT SHIFT, gold dot when on; label from props): in the header (#373) and on `/design` "Preferences"; the account preference (#66) mirrors into the same cookie. Tests: `e2e/theme.spec.ts`.
- Breakpoints, mobile first: base = mobile (375), `md:` = tablet (768), `xl:` = desktop (1280).
- Primitives import nothing from features, server or env (boundary-enforced). Import from `@/components/ui`.
- Every interactive primitive is a real element (`button`, `input`, `a`), keyboard reachable, with visible focus (global `:focus-visible` outline).
- New primitive: add it here and on `/design` in the same PR.
- Logo (wordmarks, monograms, clear space, tagline, forbidden treatments): [`logo.md`](logo.md) is the only place for these rules. The components `Wordmark` and `Monogram` (#24) render `src/components/ui/brand/assets.ts`, generated from `public/brand/*.svg` by `npx tsx scripts/brand/embed-logo.ts` (drift-checked in `scripts/brand/embed-logo.test.ts`); never edit it or the paths by hand. The site icons in `src/app/` come from `npx tsx scripts/brand/icons.ts`. Specimen: `/design` "Brand".

## Palette (`--brand-*`, design bible 3.1 and 3.2)
| Brand value | Hex | Bible use |
|---|---|---|
| `agit-red` | `#B81D24` | primary action, "you", stamps, active caret |
| `banner` | `#7E1015` | pressed/hover red |
| `ribbon-violet` | `#3E3A78` | rivals, text still to type |
| `medal-gold` | `#E2B23A` | rewards and bests, sparingly (~2%) |
| `paper` | `#F1E8D6` | main ground (light) |
| `newsprint` | `#E4D6B8` | panels (light) |
| `tape-paper` | `#E8DCC0` | typing strip, both themes |
| `backroom-grey` | `#6F736C` | steel, room walls family |
| `press-ink` | `#2A2420` | text, rules, device bezel |
| `night` | `#3E3934` | Night shift ground |
| `night-panel` | `#4B453E` | Night shift panels |
| `night-ink` | `#F4ECDC` | Night shift text |
| `night-muted` | `#CFC6B3` | Night shift muted text |
| `phosphor` | `#5CFF8A` | device numerals (phosphor) |
| `nixie` | `#FF9A3C` | device numerals (nixie) |

## Brand roles
Contrast: WCAG 2.1 ratio of each promised pair, light \| Night shift, measured from the declared values by `src/components/ui/tokens.test.ts` (text 4.5:1; `mark` and `ring` are non-text, 3:1).
| Role | Light | Night shift | Use | Contrast |
|---|---|---|---|---|
| `bg` | `paper` | `night` | page ground | ground |
| `surface` | `newsprint` | `night-panel` | panels, cards | ground |
| `fg` | `press-ink` | `night-ink` | text | `bg` 12.58 \| 9.72; `surface` 10.65 \| 8.05; `surface-muted` 9.56 \| 6.89 |
| `primary` / `primary-hover` / `primary-fg` | `agit-red` / `banner` / `paper` | same | primary action | `primary-fg` on `primary` 5.33 \| 5.33; on `primary-hover` 8.75 \| 8.75; on `pressed` 8.75 \| 8.75 |
| `pressed` | `banner` | same | pressed red, Danger button fill | ground (under `primary-fg`, row above) |
| `you` | `agit-red` | same | the player | fill |
| `rival` | `ribbon-violet` | `color-mix(in srgb, #3E3A78 50%, #F4ECDC)` | rivals: fills and marks (violet text is `untyped` / `typing-remaining`; per-rival inks #565) | mark `bg` 8.29 \| 3.86; mark `surface` 7.02 \| 3.20 |
| `reward` | `medal-gold` | same | rewards, bests (~2%) | `band` 7.77 \| 7.77; mark `bg` n/a \| 5.80 (toggle dot, night only) |
| `untyped` | `color-mix(in srgb, #3E3A78 85%, #F1E8D6)` | `#CFC6B3` | text still to type, off the tape | `bg` 5.68 \| 6.73; `surface` 4.81 \| 5.58 |
| `tape` | `tape-paper` | same | typing strip ground | ground |
| `typing-done` / `typing-next` on `typing-next-bg` / `typing-remaining` / `typing-error` | `press-ink` / `paper` on `agit-red` / `color-mix(in srgb, #3E3A78 85%, #E8DCC0)` / `agit-red` | same (always on `tape`) | typing strip character states (bible 7.7) | done `tape` 11.25 \| 11.25; next `typing-next-bg` 5.33 \| 5.33; remaining `tape` 5.23 \| 5.23; error `tape` 4.76 \| 4.76 |
| `device-phosphor` / `device-nixie` / `device-bezel` | `phosphor` / `nixie` / `press-ink` | same | device numerals and bezel | phosphor `device-bezel` 11.76 \| 11.76; nixie `device-bezel` 7.25 \| 7.25 |
| `room` | `backroom-grey` | same | room, steel | fill |
| `band` / `band-fg` / `band-muted` | `press-ink` / `paper` / `night-muted` | same | ink bands (ticker, footer, live-feed frame) and their text (bible 7.10, 14.1) | fg `band` 12.58 \| 12.58; muted `band` 9.03 \| 9.03 |

## Colour roles
Roles the palette does not name follow mapping (a) (human, 2026-10-04) on the Night shift values. Values as declared in `docs/design/tokens.css` (`--t-*`).
| Role | Light | Night shift | Use | Contrast |
|---|---|---|---|---|
| `danger` | `#7E1015` | `#F4ECDC` | text and border only; buttons fill with `pressed` | `bg` 8.75 \| 9.72; `surface` 7.41 \| 8.05; `danger-surface` 6.20 \| 8.08 |
| `danger-surface` | `color-mix(in srgb, #E4D6B8 88%, #B81D24 12%)` | `color-mix(in srgb, #4B453E 88%, #B81D24 12%)` | error panel ground (carries the red signal in Night shift) | ground |
| `success` | `#2A2420` | `#F4ECDC` | = `fg`; no green, approval is an ink stamp | `success-surface` 10.65 \| 8.05 |
| `success-surface` | `#E4D6B8` | `#4B453E` | = `surface` | ground |
| `focus` | `#2A2420` | `#F4ECDC` | = `fg`; `outline: 2px solid var(--color-focus); outline-offset: 2px` | ring `bg` 12.58 \| 9.72; ring `surface` 10.65 \| 8.05 |
| `link` | `#B81D24` | `#F4ECDC` | links, underlined in both themes | `bg` 5.33 \| 9.72; `surface` 4.51 \| 8.05 |
| `fg-muted` | `color-mix(in srgb, #2A2420 80%, #F1E8D6 20%)` | `#CFC6B3` | secondary text | `bg` 7.05 \| 6.73; `surface` 5.97 \| 5.58; `surface-muted` 5.35 \| 4.77; `danger-surface` 4.99 \| 5.60 |
| `border` | `color-mix(in srgb, #2A2420 25%, transparent)` | `color-mix(in srgb, #F4ECDC 25%, transparent)` | hairlines | decorative (2px `fg` rules carry the edges) |
| `surface-muted` | `color-mix(in srgb, #E4D6B8 94%, #2A2420 6%)` | `color-mix(in srgb, #4B453E 94%, #F4ECDC 6%)` | hover and info grounds | ground |

### Bible extensions
Where the bible's value fails WCAG (bible 3.3: text 4.5:1; WCAG 1.4.11: marks 3:1), the nearest bible-palette value that passes (sRGB mix, WCAG 2.1 luminance):
- `fg-muted` light: ink share 80% (`#524B44`) instead of backroom-grey (3.97:1): 7.05:1 on paper, 5.97:1 on newsprint, 5.35:1 on `surface-muted`, 4.99:1 on `danger-surface`.
- `typing-remaining` and `untyped`: violet share 85% instead of 55% (2.66:1 on tape): 5.23:1 on tape, 5.68:1 on paper; `untyped` dark is night-muted `#CFC6B3` (6.73:1), no violet passes on night.
- `link` dark: night-ink instead of agit-red (1.76:1): 9.72:1 on `bg`.
- `danger` dark: night-ink instead of agit-red: 9.72:1 on `bg`, 8.08:1 on the dark `danger-surface`.
- Danger button fill: `pressed` (banner) under `primary-fg` (paper), 8.75:1 in both themes; `danger` is a text and border role.
- `rival` dark (marks and fills, e.g. the 7.4 docket rule): ribbon-violet 50% with night-ink (`#9993AA`, lightness only, the violet stays) instead of ribbon-violet (1.13:1 on `bg`, 1.07:1 on `surface`): 3.86:1 on `bg`, 3.20:1 on `surface`; light keeps ribbon-violet (8.29:1, 7.02:1). 55% fails `surface` (2.87:1). #19.

## Colour usage rules
Design bible 0, 3.1, 3.3 and 7. Every colour is a role (tables above); these rules say where each family may appear. Enforced by `scripts/check-colours.ts` (`scripts/check.sh` step `colours`, rules in `scripts/lib/colour-rules.ts`): no raw hex and no `--brand-*` under `src/` (comments, tests and `%23`-encoded data URIs aside), plus the ink-ground, reward and device rules below. Read-only measurement of a screenshot: `npx tsx scripts/colour-coverage.ts <png...>`.
- **Red** (`primary`, `you`, `link`, `typing-next-bg`, `typing-error`): headers, primary actions, urgency, *you*. Never decoration.
- **Banner** (`primary-hover`, `pressed`, light `danger`): red depth, bands, the pressed and hover state of red, the Danger button fill.
- **Violet** (`rival`, `untyped`, `typing-remaining`): rivals and text still to type, locked items. Nothing else. Violet text uses `untyped` and `typing-remaining`, never `rival` (a fill and mark role, 3:1 as a mark; per-rival inks: #565).
- **Gold** (`reward`): rewards and personal bests, sparingly; also the bible 7.1 social hover and the 7.6 tag on the landing, and the night dot of the theme toggle. Gold (`reward`) is never text on `bg` or `surface` (1.37 to 1.62:1 in light): gold text lives on `band` (7.77:1); bests and rewards on paper are stamps, medals or gold on an ink plaque; the toggle dot is a state indicator also carried by `aria-pressed`. Owners: `src/features/{results,stats,landing,preferences}/**`, `src/components/ui/**`, `src/app/design/**`.
- **Focus**: the ring is measured against the ground outside the control (`outline-offset: 2px`), never against the control's fill: 12.58 \| 9.72 on `bg`, 10.65 \| 8.05 on `surface`.
- **Ink** (`fg`, `band`, `typing-done`, `device-bezel`): type, rules, bands, and the inverted label pair: an ink ground always carries paper text (7.1 ink button, 7.4 `YOU` tag, 7.5 active tab, segmented toggles), so a CSS block painting `var(--color-fg)` declares `color: var(--color-bg)` or `var(--color-band-fg)`. Never an unlabelled panel fill in light: `bg-fg`, `bg-typing-done`, `bg-room` and `bg-danger` classes are swatches for `/design` only (`bg-danger-surface` is a ground). Exceptions (bible-mandated): 7.4 grid gaps (`landing/components/sections.module.css`), 6 ink stars (`ui/star.module.css`).
- **Phosphor and nixie** (`device-*`): only inside device components (`src/components/ui/device*.tsx`), the race and `/design`. Glow lives only in devices (bible 0). Seeded exception: the inverted stamp CTA border in `lobby/components/lobby-entry.module.css` (press-ink through `device-bezel`, moved to `band` by #595).
- **Coverage** on a UI screen: paper 55 / red 28 / ink 10 / violet 5 / gold 2 (bible 3.1). `scripts/colour-coverage.ts` buckets each pixel to the nearest brand colour within sRGB distance 48 and warns (`WARN <role>`) when red or paper is more than 15 points off target or gold exceeds 6 points; advisory (`--strict` exits 1). `/design` warns by nature: it is the inventory page, not a screen.
- The allowlists live in one place, `OWNERSHIP` at the top of `scripts/check-colours.ts`; add a path only when the bible mandates the usage there, and mirror it here.

## Fonts
Loaded in `src/app/fonts.ts` (used by `src/app/layout.tsx`) with `next/font/local` from the committed woff2 subsets in `public/fonts/` (#574), so `next build` never needs the network for fonts (`scripts/offline-build.sh` builds with the font hosts unreachable); served from `/_next/static/media`, no runtime request to Google. All `display: "swap"`, with next/font's size-adjusted fallbacks except on the bare faces (Stardos Stencil, Special Elite). One `localFont` call per family and subset, each with its Google Fonts `unicode-range`; the family name is the call's const name (`Oswald`, `IBM_Plex_Mono`, ...). Preload: every family except Special Elite and VT323 emits `<link rel="preload" as="font">` on every route; flavour and device faces are `preload: false` and load on demand where a route uses them (#511, checked in `e2e/fonts.spec.ts`). Use the role token, never the family variable. Roles: art-direction 7 and design bible 4 (flavour and device: bible 4 extension).
Source: the exact woff2 files Google Fonts serves for the weights and subsets below, vendored once by `scripts/fonts-vendor.ts` (re-run by hand to update, then commit `public/fonts/`), with each family's licence from google/fonts next to them: `public/fonts/<family>-LICENSE-OFL.txt` (SIL Open Font License 1.1) for all but Special Elite, which is Apache 2.0 (`special-elite-LICENSE-Apache-2.0.txt`). Oswald is a variable font: one file per subset serves 600 and 700.
| Family | Weights | Subsets | Variable | Role token (utility) | Generic fallback | Preload | Use |
|---|---|---|---|---|---|---|---|
| Stardos Stencil | 700 | latin (only subset offered; Cyrillic falls to Oswald, "Type roles") | `--font-stardos` (bare face `--face-stardos`) | `--font-display` (`font-display`) | `Oswald, Impact, sans-serif` | yes | titles, stamps, medals |
| Oswald | 600, 700 | latin, latin-ext, cyrillic | `--font-oswald` | `--font-label` (`font-label`) | `Impact, sans-serif` | yes | labels, tabs, dockets, buttons |
| IBM Plex Mono | 400, 700 | latin, latin-ext, cyrillic | `--font-plex-mono` | `--font-typing` (`font-typing`) | `ui-monospace, monospace` | yes | text to type, data, codes |
| Special Elite | 400 | latin, latin-ext (Cyrillic falls to Oswald) | `--font-special-elite` (bare face `--face-special-elite`) | `--font-flavour` (`font-flavour`) | `Oswald, ui-monospace, monospace` | no (on demand) | story cards, cables, quotes; never text to type |
| Courier Prime | 400, 700 | latin, latin-ext | `--font-courier-prime` | `--font-body` (`font-body`) | `ui-monospace, monospace` | yes | body copy; `<body class="type-body">` (16px / 1.55) |
| VT323 | 400 | latin, latin-ext | `--font-vt323` | `--font-device` (`font-device`) | `ui-monospace, monospace` | no (on demand) | numerals in nixie tubes and CRTs only |

## Type roles
One utility per role in `docs/design/tokens.css` (`@utility`, #20) bakes face, weight, case, tracking, size and line-height; these six are the only `font-family` declarations of the app. Write the role, then at most a core size (`type-label text-xs`) to resize it. Sources: art-direction 7, design bible 2 and 4. Specimen: `/design` "Type roles".
| Role | Utility | Face | Case | Tracking | Size | When to use | Never |
|---|---|---|---|---|---|---|---|
| Display | `type-display-sm`, `type-display-md`, `type-display-lg` | Stardos Stencil 700 (Cyrillic: Oswald 700) | ALL CAPS | `0.06em` | `--text-display-{sm,md,lg}` 1.5 / 2.25 / 3.5rem, line-height 1 | titles, headings, stamps, medals, alert and empty-state titles | `text-display-*` alone (size only, no face); body copy |
| Label | `type-label` | Oswald 600 | ALL CAPS | `0.18em` | 0.875rem (`text-xs` for field labels and small buttons) | buttons, field labels, tabs, dockets, kickers, section labels | sentences; text to type |
| Typing | `type-typing` | IBM Plex Mono 400 | mixed case | normal | `clamp(1.75rem, 2.5vw, 2.25rem)` (28-36px), line-height 1.4, no ligatures | text to type, the typing strip | anything a player does not type from |
| Flavour | `type-flavour` | Special Elite 400 (Cyrillic: Oswald) | mixed case | normal | inherits | story cards, intercepted-cable headers, quotes | text to type |
| Body | `type-body` | Courier Prime 400 | sentence case | normal | 1rem, line-height 1.55, `text-wrap: pretty` (`text-sm` for hints and errors) | rules, descriptions, stats copy; the `<body>` default | titles, buttons |
| Device | `type-device` | VT323 | as written (numbers) | normal | set per device (`text-2xl`) | numerals inside nixie tubes and CRTs, with `tabular-nums` | anywhere outside a device; words |

**Cyrillic.** Oswald and IBM Plex Mono carry the `cyrillic` subset (Oswald at 600 and 700); Stardos Stencil, Special Elite and Courier Prime have none. Fallback rule: the display and flavour stacks are the bare face then Oswald (`--face-stardos` / `--face-special-elite`, then `--font-oswald`), so a Cyrillic stamp such as `НАЧАЛИ / GO` draws its Cyrillic in Oswald 700 caps with the display tracking and its Latin in Stardos Stencil, never in a system font. The bare face skips next/font's size-adjusted fallback, which is `local("Arial")` and would otherwise draw the Cyrillic first. Race texts are typed in IBM Plex Mono, which covers French and Cyrillic. `e2e/fonts.spec.ts` checks every glyph's face through Chromium's `CSS.getPlatformFontsForNode`.

## Printed look
Design bible 0 ("printed, not glowing"), 6, 7 and 17, applied to every primitive (#15):
- **Rules**: 2px solid ink (`fg`) on every bordered primitive (buttons, fields, cards, alerts); the dashed variant only for empty and locked states (7.6). Hairlines (`border`) only for separators and dashed empties.
- **Shadows**: hard print offsets only (`6px 6px 0 ink` on the stamp CTA, 7.1; the 7.6 hover lift), written where the bible places them; the tape's inner sepia (`--shadow-tape`, 3.1, 7.7) is the one soft shadow. No blur shadow anywhere; no primitive renders a `box-shadow`.
- **Radius**: none (7.4 "no radius", 6 and 17 "no rounded pill cards"); `--radius-full` stays for the spinner and dots.
- **Pressed**: banner fill (`pressed`) with the label translated 1px down; hover on red = `primary-hover`.
- **Fills**: flat roles, no gradients, no shimmer.
- **Glow**: only inside devices (phosphor, nixie): the `Device` bezel and its scoped utilities ("Printed motifs"), never on another primitive.

## Printed motifs
Design bible 0 ("printed, not glowing"), 6 and 17 (#25). Motifs are opt-in utilities in `docs/design/tokens.css` and two primitives; screens never hand-write a recipe (a new motif = a new `@utility` plus a bible 6 row). Specimen: `/design` "Printed motifs".
| Motif | Utility / component | Recipe (through roles) | Where (bible 6) | Never |
|---|---|---|---|---|
| Halftone dots | `paper-grain` | `radial-gradient(color-mix(fg 13%) 1.3px, transparent 1.7px)` at `10px 10px` | hero ground, locker left panel | on `body` or app-wide (bible 14 paints a flat paper body) |
| Red halftone on red | `paper-grain-red` on a `bg-primary` ground | `radial-gradient(color-mix(primary-hover 75%) 1.6px, transparent 2.1px)` at `11px 11px` | final-call band | on paper or ink grounds |
| Sun rays | `sun-rays` | `repeating-conic-gradient(from 0deg at 50% 92%, color-mix(primary 9%) 0deg 6deg, transparent 6deg 12deg)` | only behind a character stage (your-clerk stage, locker interior) | as a free ornament or a sunburst component (bible 17) |
| Ink misregistration | `ink-misregister` on a `type-display-*` element | `text-shadow: 1px 1px 0 var(--color-primary)`, no extra DOM, no animation; same red in both themes (bible 3.2) | display titles | on body copy, labels or text to type |
| Steep band | `Band` | flat `primary` or `pressed` strip rotated 30-45 degrees (default 38) | constructivist sections (print page bands, bible 16) | outside 30-45 degrees (the hero 8 degree gradient band and the ticker skew stay local to the landing) |
| Device glow | `device-phosphor`, `device-nixie` | `color` the device role, `text-shadow: 0 0 6px currentColor` | only on or inside `[data-device]` (the `Device` bezel); outside it the class sets nothing | glow on any primitive, text or icon outside a device (bible 0) |
| Stars | `Star` (Primitives) | bible 6 clip-path | 2-4 per section, never over text | a second star component |

Rules: the patterns are background layers over the element's own ground (they never take a pointer event and never replace the ground colour); under `prefers-contrast: more` `paper-grain`, `paper-grain-red` and `sun-rays` paint nothing, the misregistration and the device glow stay; under reduced motion nothing here moves (stars stop in `star.module.css`). The landing modules compose their halftone with the 8 degree band in one declaration and keep it local; the two hand-written sun-ray stages move to `sun-rays` in #610.

## Primitives
| Component | File | Props / variants | Type role | States | A11y notes |
|---|---|---|---|---|---|
| `Button` | `button.tsx` | `variant` primary (`primary` fill, `primary-fg` text, 2px `fg` rule; hover `primary-hover`; pressed `pressed` + 1px down), secondary (transparent, 2px `fg` rule, `fg` text; hover `surface`), ghost (no fill, no rule, `fg` text; hover underline), danger (`pressed` fill, `primary-fg` text, 2px `fg` rule); `size` sm, md, lg; `loading`; native button props | `type-label` at 0.75 / 0.875 / 1rem (sm / md / lg): the bible 7.1 label buttons; the Stardos stamp CTA is a separate pattern | default, hover, focus, active (pressed), disabled, loading | `type="button"` by default; `loading` sets `aria-busy` and disables; hover and press only when enabled |
| `Field` | `field.tsx` | `label` (required), `hint`, `error`, native input props; input = `bg` ground inside a 2px `fg` rule, the `danger` role when invalid (bible 7.2) | label `type-label text-xs`; hint and error `type-body text-sm` | default, focus, invalid, required | visible `<label>`; `aria-invalid` + `aria-describedby` link hint/error |
| `Card` | `card.tsx` | div props; docket: `surface` ground, 2px `fg` rule (bible 7.4) | inherits `type-body` | n/a | container only; put a heading inside |
| `Alert` | `alert.tsx` | `tone` info (`surface-muted`), success (`success-surface`), error (`danger-surface`); `title`; children; a docket row: 2px `fg` rule, no left rule (bible 7.4, #15) | title `type-display-sm`; message `type-body text-sm` | tones | error = `role="alert"`, others `role="status"` |
| `Spinner` | `spinner.tsx` | `size` sm, md, lg; `label` (default "Loading", `""` = decorative) | none (no text) | n/a | `role="status"` when labelled |
| `Skeleton` | `skeleton.tsx` | `className` for size; flat `surface-muted` block, no shimmer, no pulse (bible 7.4 skeleton rows) | none (no text) | n/a | `aria-hidden`; wrap groups in `aria-busy` container with a label |
| `EmptyState` | `empty-state.tsx` | `title`, `description`, `action`; 2px dashed `border` rule (bible 7.6 locked card), title `fg`, description `fg-muted` | title `type-display-sm`; description `type-body text-sm` | n/a | give it a clear next step via `action` |
| `Star` | `star.tsx` | `size`, `tone` red, ink, gold, paper, faintRed, faintInk, faintPaper; `spin` seconds; `at` absolute position | none (no text) | n/a | `aria-hidden`; bible 6: scattered, never over text; still under reduced motion |
| `Band` | `band.tsx` | `angle` degrees (clamped 30-45 by `clampAngle`, default 38), `tone` primary, pressed; `upright` counter-rotates the children on a tag of the band's fill; `className` sizes the clipping box (default `min-h-24`) | children choose (`type-label` on `primary-fg`) | n/a | `role="presentation"` without children; the strip is clipped by its box (no horizontal overflow) and takes no pointer events |
| `Device` | `device.tsx` | `tone` phosphor, nixie (`DEVICE_TONES` -> `device-phosphor` / `device-nixie`); `className`; children; `room` 2px frame, `device-bezel` interior, `data-device` | `type-device` for numerals, `type-label` for CRT words | n/a | the only place the glow lights (bible 0); colour guard `device` rule owns `src/components/ui/device*.tsx` |
| `EmbedFrame` | `embed-frame.tsx` | `src`, `title`, `decorative`, `ref`; mounts the iframe near the viewport (`data-embed` idle/mounted) | none (iframe) | idle, mounted | a `title` always; `decorative` hides it from AT and the tab order |
| `LazyVideo` | `lazy-video.tsx` | `poster`, `sources` ({src,type}[] in preference order; changing them swaps the clip), `className`; the landing **live feed is a recorded loop** of the lobby scene (bible 7.8, #552; `src/features/landing/feed-media.ts`, re-recorded by `scripts/record-live-feed.ts`) | none (video) | idle (server: poster only), armed (hydrated), near (sources written, `data-feed`) | decorative: `aria-hidden`, muted, loop, inline, no controls; nothing loads before 320px of the viewport; pauses off screen; never plays under reduced motion (poster) |
| `Wordmark` | `brand/wordmark.tsx` | `variant` red-on-paper, ink-on-red, red-on-ink; `tagline` (red-on-paper only, type-checked; only when it renders >= 240 px wide); `title`; `width` px (default 240); `clearSpace` (default true); fills: bar `primary` (red bars) or `band` (ink bar), FIFTH and COPY `band` (ink) or `band-fg` (paper) as in the file, never `fg` | none (vector) | n/a | inline `<svg role="img">` named by its `<title>`; place it on the ground its variant names; rules: [`logo.md`](logo.md) |
| `Monogram` | `brand/monogram.tsx` | `variant` paper, red, ink (its own tile); `size` 16-512 px, square (default 32); `title`; `clearSpace` (default true; `false` for icon ladders) | none (vector) | n/a | inline `<svg role="img">` named by its `<title>`; rules: [`logo.md`](logo.md) |
| `useNearViewport` / `useInViewport` | `use-near-viewport.ts` | `(ref, margin = NEAR_VIEWPORT 320px)` -> boolean, latched; `(ref)` -> on screen now | none (hook) | n/a | shared by `EmbedFrame` and `LazyVideo` |
| `MotionSafe` / `useReducedMotion` | `motion.tsx` | `fallback`, children; hook -> boolean ("Motion" below) | none | motion on, reduced | SSR renders children (hook false on the server), then the live value; no hydration warning |
| `useEmbedBridge` | `use-embed-bridge.ts` | `(schema?, onMessage?)` -> `{ ref, post }`: same-origin postMessage to and from that iframe (bible 15) | none (hook) | n/a | parses every incoming message with the zod schema |

## Motion
Design bible 8 (durations, reduced motion) and WCAG 2.3.1 / 2.3.3. Tokens: `docs/design/tokens.css` (#28).
- **Durations come from the tokens only**: `--motion-duration-fast` 120ms (Tailwind `transition-*` default), `--motion-duration-base` 200ms, `--motion-duration-slam` 350ms, `--motion-duration-slow` 600ms, with `--motion-ease-out` and `--motion-ease-slam`. Never a literal duration in a transition or a new animation. The bible-8 keyframes (`fcCaret` 1.05s, `fcMarquee` 36s, `fcSpin`, `fcBob` 4s, `lkPulse`, the slams) keep their listed seconds. `--motion-duration-slam` (350ms, inside bible 8's 0.3-0.45s slam) drives the `Stamp` `fcSlam` (#26); the local lobby and not-found slams keep their seconds until #614 moves them to the primitive.
- **One setting**: `prefers-reduced-motion: reduce` or `<html data-motion="reduce">` (the settings card #66 sets it like `data-theme`). Both zero the four durations; every keyframe block stops (`animation: none`) under both selectors; `motion-reduce:` (Tailwind) covers both (`Spinner`, `Skeleton`). No `!important`. Script motion reads `useReducedMotion()`; swapped markup uses `<MotionSafe fallback={still}>`. The 3D iframes inherit the media query natively; `data-motion` does not cross the iframe, so the 3D consumers pass it through the embed bridge (bible 15).
- **Flash rule**: no element changes luminance more than **three** times in any one-second window (a flash = a pair of opposing changes); no flash covers more than **25% of the viewport**; nothing ever flashes the whole screen. Prefer transform (scale, rotate, translate) to opacity or colour for any loop.
- **Consumers and their allowed pattern**: the bulb flicker (#272): bible 11.1 stutter `0, 1, 0, 0.6, 0, 1` over 0.5s, at most once per 5s, hum within ±2% (under WCAG's 10% luminance step); the stutter counts as a flash wherever the bulb's light swings an area above 25% of the viewport by 10% relative luminance or more, so #272 measures it and stays within three per second; under reduce the bulb is steady (the Ring Room STEADY mode). The stamps (#26, `Stamp`): one slam, transform plus a single opacity 0 to 1 at mount, never repeated; none under reduce (the stamp is simply there, `onSettled` still fires once). The medals (#310): same as stamps. The orbit camera (#288): stops under reduce on the static overview. The typing error flash: one key cell, never the keyboard or the screen.

## Screen states checklist (every `ui` card)
empty (`EmptyState`), loading (`Skeleton`/`Spinner` inside an `aria-busy` region), error (`Alert tone="error"`), populated. Mobile, tablet, desktop. Light and dark.

## Utilities
`cn(...)` in `src/lib/cn.ts` joins class names.
