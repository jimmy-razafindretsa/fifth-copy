# Component inventory (`src/components/ui`)

Status: starter primitives (#7) wearing the Fifth Copy palette and colour roles (#16, design bible section 3), the six brand fonts (#21) and the six type roles (#20: buttons and labels in Oswald, titles in Stardos Stencil, copy in Courier Prime). Still to come: printed geometry #15, theme switching #19.
Living page: `/design` (`src/app/design/page.tsx`); tests: `e2e/design.spec.ts` (visual baselines tagged `@visual`).

## Rules
- Tokens only: `docs/design/tokens.css` is the single source. Tailwind's default palette is removed, so `bg-zinc-50` does not exist; use semantic utilities (`bg-surface`, `text-fg`, `text-fg-muted`, `border-border`, `bg-primary`, `text-danger`, ...). Spacing uses the Tailwind scale (`p-4`), radius `rounded-{sm,md,lg,full}`, type through the six roles of "Type roles" below (`type-display-{sm,md,lg}`, `type-label`, `type-typing`, `type-flavour`, `type-body`, `type-device`), sizes `text-{xs..3xl}` only to resize a role. The bare faces `font-{display,label,typing,flavour,body,device}` exist for code samples only (`font-sans`/`font-mono` do not exist).
- Colours: brand values (`--brand-*`) are never used directly and are not utilities; use a role from the tables below (`bg-you`, `text-rival`, `bg-tape`, ...). Write class names as complete literals (`"bg-you"`, never `` `bg-${role}` ``): Tailwind only emits classes it finds as whole strings.
- Links: `text-link underline` in both themes.
- Themes: light by default, dark via `prefers-color-scheme` or `<html data-theme="dark">`. Never use `dark:` color overrides; the tokens switch.
- Breakpoints, mobile first: base = mobile (375), `md:` = tablet (768), `xl:` = desktop (1280).
- Primitives import nothing from features, server or env (boundary-enforced). Import from `@/components/ui`.
- Every interactive primitive is a real element (`button`, `input`, `a`), keyboard reachable, with visible focus (global `:focus-visible` outline).
- New primitive: add it here and on `/design` in the same PR.
- Logo (wordmarks, monograms, clear space, tagline, forbidden treatments): [`logo.md`](logo.md) is the only place for these rules.

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
| Role | Light | Night shift | Use |
|---|---|---|---|
| `bg` | `paper` | `night` | page ground |
| `surface` | `newsprint` | `night-panel` | panels, cards |
| `fg` | `press-ink` | `night-ink` | text |
| `primary` / `primary-hover` / `primary-fg` | `agit-red` / `banner` / `paper` | same | primary action |
| `pressed` | `banner` | same | pressed red, Danger button fill |
| `you` | `agit-red` | same | the player |
| `rival` | `ribbon-violet` | same | rivals (fills and marks; as text see #27) |
| `reward` | `medal-gold` | same | rewards, bests (~2%) |
| `untyped` | `color-mix(in srgb, #3E3A78 85%, #F1E8D6)` | `#CFC6B3` | text still to type, off the tape |
| `tape` | `tape-paper` | same | typing strip ground |
| `typing-done` / `typing-next` on `typing-next-bg` / `typing-remaining` / `typing-error` | `press-ink` / `paper` on `agit-red` / `color-mix(in srgb, #3E3A78 85%, #E8DCC0)` / `agit-red` | same (always on `tape`) | typing strip character states (bible 7.7) |
| `device-phosphor` / `device-nixie` / `device-bezel` | `phosphor` / `nixie` / `press-ink` | same | device numerals and bezel |
| `room` | `backroom-grey` | same | room, steel |
| `band` / `band-fg` / `band-muted` | `press-ink` / `paper` / `night-muted` | same | ink bands (ticker, footer, live-feed frame) and their text (bible 7.10, 14.1) |

## Colour roles
Roles the palette does not name follow mapping (a) (human, 2026-10-04) on the Night shift values. Values as declared in `docs/design/tokens.css` (`--t-*`).
| Role | Light | Night shift | Use |
|---|---|---|---|
| `danger` | `#7E1015` | `#F4ECDC` | text and border only; buttons fill with `pressed` |
| `danger-surface` | `color-mix(in srgb, #E4D6B8 88%, #B81D24 12%)` | `color-mix(in srgb, #4B453E 88%, #B81D24 12%)` | error panel ground (carries the red signal in Night shift) |
| `success` | `#2A2420` | `#F4ECDC` | = `fg`; no green, approval is an ink stamp |
| `success-surface` | `#E4D6B8` | `#4B453E` | = `surface` |
| `focus` | `#2A2420` | `#F4ECDC` | = `fg`; `outline: 2px solid var(--color-focus); outline-offset: 2px` |
| `link` | `#B81D24` | `#F4ECDC` | links, underlined in both themes |
| `fg-muted` | `color-mix(in srgb, #2A2420 80%, #F1E8D6 20%)` | `#CFC6B3` | secondary text |
| `border` | `color-mix(in srgb, #2A2420 25%, transparent)` | `color-mix(in srgb, #F4ECDC 25%, transparent)` | hairlines |
| `surface-muted` | `color-mix(in srgb, #E4D6B8 94%, #2A2420 6%)` | `color-mix(in srgb, #4B453E 94%, #F4ECDC 6%)` | hover and info grounds |

### Bible extensions
Where the bible's value fails WCAG 3.3 (4.5:1), the nearest bible-palette value that passes (sRGB mix, WCAG 2.1 luminance):
- `fg-muted` light: ink share 80% (`#524B44`) instead of backroom-grey (3.97:1): 7.05:1 on paper, 5.97:1 on newsprint, 5.35:1 on `surface-muted`, 4.99:1 on `danger-surface`.
- `typing-remaining` and `untyped`: violet share 85% instead of 55% (2.66:1 on tape): 5.23:1 on tape, 5.68:1 on paper; `untyped` dark is night-muted `#CFC6B3` (6.73:1), no violet passes on night.
- `link` dark: night-ink instead of agit-red (1.76:1): 9.72:1 on `bg`.
- `danger` dark: night-ink instead of agit-red: 9.72:1 on `bg`, 8.08:1 on the dark `danger-surface`.
- Danger button fill: `pressed` (banner) under `primary-fg` (paper), 8.75:1 in both themes; `danger` is a text and border role.

## Fonts
Loaded in `src/app/layout.tsx` with `next/font/google` (fetched at build, served from `/_next/static/media`, no runtime request to Google), all `display: "swap"` with next/font's size-adjusted fallbacks. Use the role token, never the family variable. Roles: art-direction 7 and design bible 4 (flavour and device: bible 4 extension).
| Family | Weights | Subsets | Variable | Role token (utility) | Generic fallback | Use |
|---|---|---|---|---|---|---|
| Stardos Stencil | 700 | latin (only subset offered; Cyrillic falls to Oswald, "Type roles") | `--font-stardos` (bare face `--face-stardos`) | `--font-display` (`font-display`) | `Oswald, Impact, sans-serif` | titles, stamps, medals |
| Oswald | 600, 700 | latin, latin-ext, cyrillic | `--font-oswald` | `--font-label` (`font-label`) | `Impact, sans-serif` | labels, tabs, dockets, buttons |
| IBM Plex Mono | 400, 700 | latin, latin-ext, cyrillic | `--font-plex-mono` | `--font-typing` (`font-typing`) | `ui-monospace, monospace` | text to type, data, codes |
| Special Elite | 400 | latin, latin-ext (Cyrillic falls to Oswald) | `--font-special-elite` (bare face `--face-special-elite`) | `--font-flavour` (`font-flavour`) | `Oswald, ui-monospace, monospace` | story cards, cables, quotes; never text to type |
| Courier Prime | 400, 700 | latin, latin-ext | `--font-courier-prime` | `--font-body` (`font-body`) | `ui-monospace, monospace` | body copy; `<body class="type-body">` (16px / 1.55) |
| VT323 | 400 | latin, latin-ext | `--font-vt323` | `--font-device` (`font-device`) | `ui-monospace, monospace` | numerals in nixie tubes and CRTs only |

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

## Primitives
| Component | File | Props / variants | Type role | States | A11y notes |
|---|---|---|---|---|---|
| `Button` | `button.tsx` | `variant` primary, secondary, ghost, danger (fills with `pressed`, paper text); `size` sm, md, lg; `loading`; native button props | `type-label` at 0.75 / 0.875 / 1rem (sm / md / lg): the bible 7.1 label buttons; the Stardos stamp CTA is a separate pattern | default, hover, focus, disabled, loading | `type="button"` by default; `loading` sets `aria-busy` and disables |
| `Field` | `field.tsx` | `label` (required), `hint`, `error`, native input props | label `type-label text-xs`; hint and error `type-body text-sm` | default, focus, invalid, required | visible `<label>`; `aria-invalid` + `aria-describedby` link hint/error |
| `Card` | `card.tsx` | div props | inherits `type-body` | n/a | container only; put a heading inside |
| `Alert` | `alert.tsx` | `tone` info, success, error; `title`; children | title `type-display-sm`; message `type-body text-sm` | n/a | error = `role="alert"`, others `role="status"` |
| `Spinner` | `spinner.tsx` | `size` sm, md, lg; `label` (default "Loading", `""` = decorative) | none (no text) | n/a | `role="status"` when labelled |
| `Skeleton` | `skeleton.tsx` | `className` for size | none (no text) | n/a | `aria-hidden`; wrap groups in `aria-busy` container with a label |
| `EmptyState` | `empty-state.tsx` | `title`, `description`, `action` | title `type-display-sm`; description `type-body text-sm` | n/a | give it a clear next step via `action` |
| `Star` | `star.tsx` | `size`, `tone` red, ink, gold, paper, faintRed, faintInk, faintPaper; `spin` seconds; `at` absolute position | none (no text) | n/a | `aria-hidden`; bible 6: scattered, never over text; still under reduced motion |
| `EmbedFrame` | `embed-frame.tsx` | `src`, `title`, `decorative`, `ref`; mounts the iframe near the viewport (`data-embed` idle/mounted) | none (iframe) | idle, mounted | a `title` always; `decorative` hides it from AT and the tab order |
| `useEmbedBridge` | `use-embed-bridge.ts` | `(schema?, onMessage?)` -> `{ ref, post }`: same-origin postMessage to and from that iframe (bible 15) | none (hook) | n/a | parses every incoming message with the zod schema |

## Screen states checklist (every `ui` card)
empty (`EmptyState`), loading (`Skeleton`/`Spinner` inside an `aria-busy` region), error (`Alert tone="error"`), populated. Mobile, tablet, desktop. Light and dark.

## Utilities
`cn(...)` in `src/lib/cn.ts` joins class names.
