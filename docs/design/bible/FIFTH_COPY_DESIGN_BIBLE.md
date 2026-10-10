# FIFTH COPY — Design Bible (source of truth)

> **Read this first.** This file is the single source of truth for every visual, motion, 3D, copy and UX decision on FIFTH COPY. If code, a screenshot, or a past file disagrees with this document, **this document wins**. If something is not covered here, extend the closest existing pattern. Do not invent a new one. When you make a new decision, **add it to this file** in the same change.
>
> Companion files (bundled with this one):
> - `FIFTH_COPY_SPEC.md`: product and feature spec (rules, lobbies, stats, accounts, stack). The **what**.
> - `FIFTH_COPY_PERF_AUDIT.md`: performance numbers and presets.
> - This file: the **how it looks, moves, sounds and reads**.

---

## 0. Precedence & how to use this file

1. Brief constraints from the teacher (FR/EN, ages 12–17, 30+ live, no email, no AI-made logo) override everything.
2. Then this Design Bible.
3. Then `FIFTH_COPY_SPEC.md`.
4. Then the reference implementations in `/reference` (section 16). Match them pixel-for-pixel unless this file says otherwise.

**Golden rules (never break):**
- **Red marks authority, urgency and *you*.** In the **3D room the only red is the flags**. On UI screens red is the primary action and the player.
- **Printed, not glowing.** Ink on paper, stamps, halftone, misregistration. Glow lives only in CRT screens, nixie tubes, the bulb and cigarette embers.
- **Toy-sized bureaucracy.** Big heads, mitten hands, chubby pear bodies, oversized caps. Never grim, never gory, never political propaganda aimed at students. It is a **deadpan cartoon of office life**.
- **Everything is bilingual (EN/FR)**, and a given block shows **one language at a time**. Never mix both languages in one line, except in-world stamps that are explicitly dual (e.g. `ОБГОН! · OVERTAKE`).
- **Performance is a design constraint.** 30+ clerks must run on a school Chromebook. Every 3D asset follows the budgets in section 11.

---

## 1. The product in one breath

A Kahoot-style **multiplayer typing race** for secondary-school students (12–17) in **English and French**. A host (the teacher) opens a room. Everyone types **the same message at the same time**. The fastest clean copy wins the medal. The fiction: **Moscow, 1978**. Deep in a ministry nobody can name are **countless "ring rooms"**. Each has **30 desks in a perfect ring**, a typewriter on every desk, and **the Major** standing on a slowly turning platform in the middle, watching. Nobody knows what the messages mean. **The ring rooms never stop typing.**

- Name: **FIFTH COPY**. With carbon paper, each sheet lower in the stack comes out fainter, and by the fifth copy you squint. No other lore is needed.
- Tagline (always English, brand line): **TYPE FAST · TYPE FIRST**.
- Builder credit: **Built by Aegis Corp.** / FR **Conçu par Aegis Corp.**

---

## 2. Voice & copy

**Tone:** deadpan ministry paperwork with a wink. Short declarative sentences. Bureaucratic nouns (form, file, docket, issue, desk, stamp, rank). Never sarcastic toward the player, never edgy, never violent.

**Rules**
- Labels and buttons: **ALL CAPS**, short verbs: `QUICK RACE`, `JOIN →`, `SIGN & FILE`, `REISSUE UNIFORM`.
- Body: sentence case, Courier Prime, 1–3 sentences per paragraph, `text-wrap: pretty`.
- Numbers as paperwork: `№ 0457`, `DESK 05`, `FORM 5-C`, `ROOM 457`, `CAM 02 · 30/30`.
- Guest names: `Comrade <Animal>-<3 digits>` / `Camarade <Animal>-<3 digits>`. Animals (EN/FR): Sparrow/Moineau, Badger/Blaireau, Heron/Héron, Marmot/Marmotte, Lynx/Lynx, Otter/Loutre, Crow/Corbeau, Hedgehog/Hérisson.
  - Extension (#32): the full guest word lists (>= 60 EN and >= 60 FR common nouns and animals, starting with these 8, no proper names) live in `src/features/identity/guest/words.ts`. Stored names are bare (`Sparrow-482`, digits 100-999, 4 digits on collision); the honorific is UI copy.
- Period details (papirosa smoke, ashtrays, vodka on the Major's side table) are **set dressing only**. They never appear in copy as jokes, rewards or instructions to students.
- The French is Québec-friendly: `courriel`, `clavardage`, `chandail`, "tu" form for the player.

**Canonical strings** (reuse exactly):
| Key | EN | FR |
|---|---|---|
| Primary CTA | QUICK RACE | COURSE RAPIDE |
| CTA searching | FINDING A ROOM… | RECHERCHE… |
| Secondary | CREATE PRIVATE RACE | CRÉER UNE COURSE PRIVÉE |
| Join | JOIN WITH CODE / JOIN → | CODE / ENTRER → |
| Code placeholder | KGB-4821 | KGB-4821 |
| Theme | NIGHT SHIFT | QUART DE NUIT |
| Guest tag | GUEST | INVITÉ |
| Sign in | SIGN IN | CONNEXION |
| Typing ok stamp | ACCEPTED · 48 WPM | ACCEPTÉ · 48 MPM |
| Typing errors stamp | RETURNED · 2 ERRORS | RETOURNÉ · 2 FAUTES |
| Story headline | THE RING ROOMS NEVER STOP TYPING. | LES SALLES EN ANNEAU NE S'ARRÊTENT JAMAIS DE TAPER. |
| Pull quote | SPEED IS GOOD. ACCURACY IS BETTER. BOTH EARN A MEDAL. | LA VITESSE, C'EST BIEN. LA PRÉCISION, C'EST MIEUX. LES DEUX, C'EST UNE MÉDAILLE. |
| Final CTA | REPORT TO YOUR DESK. | PRÉSENTE-TOI À TON BUREAU. |
| Live badge | LIVE | EN DIRECT |
| Save | SIGN & FILE → stamp FILED | SIGNER ET CLASSER → CLASSÉ |
| Equipped | ISSUED | ATTRIBUÉ |
| Locked | LOCKED | VERROUILLÉ |
| New | NEW | NOUVEAU |
| Ranks | RECRUIT · CLERK · OFFICER · COMMISSAR · HERO OF PAPERWORK | RECRUE · COMMIS · OFFICIER · COMMISSAIRE · HÉROS DE LA PAPERASSE |
| Ticker EN | TYPE FAST ★ TYPE FIRST ★ NO TYPOS ★ THIRTY DESKS ★ ONE MESSAGE | — |
| Ticker FR | — | ÉCRIS VITE ★ ÉCRIS LE PREMIER ★ SANS FAUTE ★ TRENTE BUREAUX ★ UN SEUL MESSAGE |

---

## 3. Colour

### 3.1 Core palette (tokens)
| Token | Hex | Use |
|---|---|---|
| `agit-red` | `#B81D24` | primary action, "you", stamps, flags (3D), active caret |
| `banner` | `#7E1015` | pressed/hover red, red depth, halftone dots on red |
| `ribbon-violet` | `#3E3A78` | rivals, text still to type (55% opacity), locked items |
| `medal-gold` | `#E2B23A` | rewards, bests, hover on dark, gold star cursor. **Sparingly (~2%)** |
| `paper` | `#F1E8D6` | main ground |
| `newsprint` | `#E4D6B8` | panels, cards, alternate sections |
| `tape-paper` | `#E8DCC0` | typing strip / telex paper (with inner shadow `inset 0 0 22px rgba(156,122,69,.45)`) |
| `backroom-grey` | `#6F736C` | muted text on paper, steel, 3D walls family |
| `press-ink` | `#2A2420` | text, rules, borders, dark bands, footer ground |

**Coverage on UI screens:** paper 55% · red 28% · ink 10% · violet 5% · gold 2%.

### 3.2 Night shift theme (dark)
It is *not* black. It's a warm, readable grey-brown.
| Token | Light | Night |
|---|---|---|
| `--paper` | `#F1E8D6` | `#3E3934` |
| `--news` | `#E4D6B8` | `#4B453E` |
| `--ink` | `#2A2420` | `#F4ECDC` |
| `--muted` | `#6F736C` | `#CFC6B3` |
Reds and gold never change between themes. The tape strip stays `tape-paper` in both. Theme is implemented with CSS variables on the page root, and every style uses `var(--x, <light fallback>)`.

### 3.3 Contrast
Text is 4.5:1 minimum. Never put muted text on red. On red grounds use paper or ink at full opacity.
Red kicker and label text on Night shift uses night-ink (the link role): agit-red on the night ground is 1.76:1 (extension, #494).
Red error text (the inline error line, 7.4) follows the same link role: agit-red on newsprint in light (5.0:1), night-ink on night newsprint on Night shift (extension, #99).
Violet rival marks (fills, rules such as the 7.4 docket rule) on Night shift use ribbon-violet mixed 50% with night-ink: ribbon-violet on the night ground is 1.13:1, the mix 3.86:1 on night and 3.20:1 on night newsprint (non-text 3:1, WCAG 1.4.11). Violet text stays the text-still-to-type roles; gold is never text on paper or newsprint (1.62:1), only on ink grounds (extension, #19).

---

## 4. Typography

| Role | Font | Rules |
|---|---|---|
| Display / titles / stamps / big buttons | **Stardos Stencil 700** | ALL CAPS, tracking +2–10% (`letter-spacing:.02–.1em`), line-height 0.95–1.0 |
| Labels, tabs, dockets, small buttons, kickers | **Oswald 600** | ALL CAPS, tracking +14–24% (`.14em–.24em`), 10–14px |
| Typing text, data, codes, names, timecodes | **IBM Plex Mono 400/500** | Mixed case. Typing 28–36px (`clamp(20px,2.2vw,30px)` in compact strips) |
| Body copy | **Courier Prime 400/700** | 15–21px, line-height 1.5–1.6, `text-wrap: pretty` |

Google Fonts URL:
`https://fonts.googleapis.com/css2?family=Stardos+Stencil:wght@400;700&family=Oswald:wght@500;600&family=IBM+Plex+Mono:wght@400;500&family=Courier+Prime:wght@400;700&display=swap`

**Flavour and device faces (extension, #21, from `docs/spec/art-direction.md` 7):** **Special Elite 400** for story cards, intercepted-cable headers and quotes (never text to type), and **VT323 400** for numerals inside nixie tubes and CRTs only. With them the app ships six faces; the loaded weights are Stardos Stencil 700, Oswald 600/700, IBM Plex Mono 400/700, Courier Prime 400/700, all self-hosted through `next/font` (no Google Fonts URL at runtime). Inventory: `docs/design/components.md` "Fonts".

**Scale (desktop):** hero wordmark `clamp(64px,8.6vw,138px)` · section H2 `clamp(36px,4.4vw,60px)` · final CTA `clamp(40px,6vw,88px)` · kicker 13px Oswald · body 16–21px.

**Kicker pattern:** red Oswald 13px `.24em` above every H2 (e.g. `CASE FILE · THE STORY`, `ARCHIVE · DECLASSIFIED`, `PERSONNEL FILE`).

---

## 5. Logo & icon (exact geometry)

**Never redraw or approximate. Use these ratios.** (The final logo must be hand-redrawn by the team per the brief. These ratios define the target.)

### 5.1 Wordmark
Let `f` = font-size of "FIFTH" (set on the container as `font-size`; everything below in `em` of the container).
- Container: `position:relative; width:4.375em; height:1.8333em`
- `FIFTH`: `left:0; top:0; font:700 1em/0.9 'Stardos Stencil'; letter-spacing:.02em; color:ink` (or paper on dark/red)
- Bar: `left:1em; top:0.979em; width:3.4375em; height:0.7917em; background:<second colour>; transform:skewY(-8deg); transform-origin:0 100%`
- `COPY`: `font:700 0.75em/1 'Stardos Stencil'; letter-spacing:.12em; color:paper; transform:skewY(-8deg); transform-origin:0 100%`. **Its own offsets are in its own em:** `left:1.6389em; top:1.3333em`.
- Second colour (the bar): **red on paper and on night; ink on red.**
- Tagline under it: Oswald 600 12–14px, `letter-spacing:.32–.36em`, `TYPE FAST · TYPE FIRST`.
- The 8° slant of the bar is the brand angle. Diagonal bands and hatching use **8°** (or 4° for big skewed sections).

### 5.2 FC monogram (icon)
For size `S` (px): radius `0.225S`. Background red (or paper/ink).
- `F`: left `0.13S`, top `0.08S`, `700 0.56S/0.9 Stardos Stencil`, paper.
- Bar: left `0.2S`, top `0.5S`, width `0.95S`, height `0.36S`, ink, `skewY(-8deg)`, origin `0 100%`.
- `C`: left `0.4S`, top `0.47S`, `700 0.44S/1`, **same colour as the background** (knocked out), same skew.
- Works down to 16px (favicon).
- Site icons (extension, #24): the paper-tile monogram is the favicon (16 and 32 px, transparent corners) and the SVG icon; the 180px Apple touch icon is the same raster flattened on paper, since iOS paints transparency black. Details: `docs/design/logo.md` "Site icons".

Rules: no recolouring the bar violet or gold, never straighten it, and keep clear space of one bar height around the mark.

---

## 6. Graphic motifs

| Motif | Recipe | Where |
|---|---|---|
| **Halftone dots** | `radial-gradient(rgba(42,36,32,.13) 1.3px, transparent 1.7px)` at `10px 10px` | hero ground, locker left panel |
| **Red halftone on red** | `radial-gradient(rgba(126,16,21,.75) 1.6px, transparent 2.1px)` at `11px 11px` | final CTA band |
| **Sun rays** (reserved) | `repeating-conic-gradient(from 0deg at 50% 92%, rgba(184,29,36,.09) 0deg 6deg, transparent 6deg 12deg)` | **only behind characters** (your-clerk stage, locker interior) |
| **8° band** | `linear-gradient(172deg, transparent 0 62%, rgba(184,29,36,.07) 62% 70%, transparent 70%)` | layered over halftone in the hero |
| **Skewed ticker band** | section `background:ink; transform:skewY(-4deg); border-top:14px solid red`, scrolling text (see 8.4) | between hero and story |
| **Stars** | `clip-path: polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)`, slowly spinning (`fcSpin` 14–90s) | scattered: red, ink, gold, and big faint (`rgba(...,.08–.14)`) 150–180px stars behind sections. 2–4 per section, never over text |
| **Scanlines** | `repeating-linear-gradient(0deg, rgba(42,36,32,.12) 0 1px, transparent 1px 3px)` multiply | on live camera feeds |
| **Parallelogram frame** | `clip-path: polygon(12% 0,100% 0,100% 100%,0 100%)` | hero live feed |
| **Steep band** (extension, #25) | flat agit-red (or banner) strip rotated **30–45°** (default 38°, from the print page bands at 36° / −38°, 16), clipped by its box; a level label rides on a tag of the same fill | constructivist section accents; the 8° band and the ticker skew stay as above |
| **Misregistration** (extension, #25) | `text-shadow: 1px 1px 0 agit-red` under a stencil display title, no extra DOM, no animation; same red in both themes (3.2) | display titles only |
| **Device glow** (extension, #25) | `text-shadow: 0 0 6px currentColor` in the phosphor or nixie colour, only inside a device bezel (backroom-grey 2px frame, press-ink interior) | nixie tubes and CRT screens only (0); nowhere else |

**Do not** use generic gradients, glassmorphism, rounded pill cards, emoji or drop-shadow blur. Shadows are **hard print offsets** only.

Textures are opt-in, never on the page body (14 paints a flat paper body). Under `prefers-contrast: more` the halftones and sun rays paint nothing (the ground stays flat); misregistration and device glow stay (extension, #25, from the reduced-motion pattern of 8). Implementation: `docs/design/components.md` "Printed motifs".

---

## 7. Components (UI)

### 7.1 Buttons
- **Primary (stamp button):** Stardos 700 30–44px, `.08em`, `background:red; color:paper; border:3px solid ink; padding:20px 36px; box-shadow:6px 6px 0 ink`. Hover `background:banner`. Active `transform:translate(4px,4px); box-shadow:2px 2px 0 ink`.
- **Inverted primary** (on red): paper bg, red text, same ink border and shadow.
- **Secondary:** Oswald 600 13px `.16em`, transparent, `2px solid ink`, `padding:12px 18px`, hover `background:newsprint`.
- **Ink button:** Oswald 600 13px, `background:ink; color:paper`, hover red.
- **Segmented toggle** (EN/FR, views): `border:2px solid ink`, buttons Oswald 600 11–12px; active = ink bg + paper text.
- **Social button** (footer): `2px solid rgba(paper,.35)`, 26px red square tag with stencil abbreviation (GH, IN, DC, YT), hover border/text gold.
- Extension (#20): the `Button` primitive is this label-button family (secondary, ink, segmented): Oswald 600 caps `.18em` through the `type-label` role at 12 / 14 / 16px for sm / md / lg, in every variant. The Stardos stamp CTA (primary, inverted) is a separate pattern, never a `Button` size.
- Extension (#15): the `Button` primary variant is a red label button: `background:red; color:paper; border:2px solid ink`, hover banner, active banner with the label 1px down, no shadow, no radius. The ghost variant is the link-like label: no fill, no border, ink text, underline on hover. Danger fills with banner under paper text and the same 2px ink rule.
- Extension (#560): **Abandon** (spec 4.4), always visible in the seat view: the secondary `Button` `ABANDON` / `ABANDONNER`; pressed, the ink button `CONFIRM · REASSIGN ME` / `CONFIRMER · ME RÉAFFECTER` appears beside it (ABANDON becomes its disclosure, `aria-expanded`). `Escape`, a second ABANDON or 5 s without an answer cancel. Disabled (before GO, after finishing) it stays visible and inert. Both buttons are at least 44px tall.

### 7.2 Inputs
- Room code: inside an ink-bordered newsprint group: `[ JOIN WITH CODE | KGB-4821 | JOIN → ]`. Input IBM Plex Mono 500 18px `.08em`, auto-uppercase, maxLength 8.
  - Extension (#99): the placeholder is muted ink (`--color-fg-muted`), not ink at 40% (which fails 4.5:1). Focus shows a 2px ink outline around the whole group, not the bare input. Labels and the `JOIN →` button never wrap; at widths <= 480px the label becomes the group's header row (2px ink rule under it, as the 7.4 docket header) and the input flexes from 130px. On touch widths (<= 768px) the create button, the input and `JOIN →` are at least 44px tall (18).
  - Pending (#99): the submitting button reads `CREATING…` / `JOINING…`, is disabled and `aria-busy`; no spinner (printed, not glowing).

### 7.3 Stamps
- Border `4px double red` (or 3px double gold on dark), Stardos 700, rotated **−8° to +7°** (always a little crooked), paper-ish bg `rgba(241,232,214,.9)`.
- Entry animation: **slam** (scale 2.2 → 0.9 → 1, rotation settles), 0.3–0.45s.
- Examples: `ACCEPTED · 48 WPM`, `FILED`, `ISSUED`, `ROOM 457 / 30 SEATS` (bobbing), `BUILT BY / AEGIS CORP.`
- Extension (#107): on UI screens the stamp text uses the link role (red on paper, night-ink on Night shift: agit-red on the night ground is 1.76:1, 3.3); the `4px double` border stays red in both themes. Ground `color-mix(in srgb, var(--color-bg) 90%, transparent)`. The `HOST` stamp is the `Stamp` primitive at `sm` (Stardos 700 1.5rem `.06em`, `padding:2px 8px`), a fixed −6°, slamming in with `fcSlam` 0.35s from −14°; none under reduced motion. No local stamp class remains (#614).
- Extension (#26): every UI stamp is the `Stamp` primitive (`src/components/ui/stamp.tsx`; the lobby HOST and FILE NOT FOUND stamps move to it in #614). **Two lines**: the headline in Stardos (the display role), then an optional second line in Oswald 600 caps (the label role); a bilingual in-world stamp puts its dual headline on line one and the other language on line two (`ОБГОН! · OVERTAKE` / `DÉPASSEMENT`), the Cyrillic tagged `lang="ru"`. **Sizes** sm / md / lg = the display role at 1.5 / 2.25 / 3.5rem with `padding` 2px 8px (the HOST badge), 8px 14px (FILE NOT FOUND), 12px 20px; the lg stamp wraps inside a 375px phone. **Angle** −6° to +6° (R29, inside the range above); an event stamp takes an angle seeded by its event, so the same event always lands at the same angle, never closer than 2° to level. **The ink tone**: for neutral paperwork (`PASSED`, a merge confirmation) the stamp is ink, text and `4px double` rule both in the `fg` role (press-ink on paper, night-ink on Night shift); red stays for you, urgency and authority (0). The slam is `fcSlam` on `--motion-duration-slam` 350ms (8).

### 7.4 Dockets / file cards
- Paper or newsprint, `2px solid ink`, no radius. Header row with mono name plus Oswald tag. Rows are a grid `120px | 1fr` with dashed separators `1px dashed rgba(42,36,32,.3)`.
- **Inline error line** (extension, #99): one docket row under the control it belongs to, `2px solid ink`, newsprint, `padding:8px 12px`, Courier Prime 15px in the red text role (3.3), led by an Oswald 600 11px `.16em` prefix `RETURNED ·` (the rejection word of 7.7). `role="alert"`, linked to its field with `aria-describedby`; it never echoes what the player typed.
- Multi-cell grids use `gap:2px; background:ink` on the grid with paper cells. **Never** per-cell borders (they double up when the grid wraps).
- **Roll rows** (extension, #107): a list of people is a `ul` inside a docket, one `li` per person as a `120px | 1fr` row: `DESK 05` (Oswald 600 11px `.2em`, muted) | name (IBM Plex Mono 400 18px) then its badges (a 7.3 stamp such as `HOST`, the ink `YOU` tag: Oswald 600 10px `.16em`, ink bg, paper text, `padding:1px 6px`). Badges wrap under the name on phones. The roll docket sits on paper (the room docket beside it on newsprint); it scrolls inside itself (`max-height:60vh`), focusable and named.
- **Skeleton rows** (extension, #107): the same row grid with flat newsprint blocks, no shimmer and no gradient (6), the list `aria-busy="true"`.
- **Alert row** (Extension (#15)): an inline message is a docket row: the tone in its ground (newsprint-tinted info, newsprint success, red-tinted error), `2px solid ink`, no left rule, no radius; title Stardos 700, message Courier Prime.
- **Notice row** (extension, #107): a live-state label row at the top of a docket (e.g. `CONNECTION LOST, RETRYING`), Oswald 600 11px `.16em`, dashed separator under it, pulsing with `lkPulse` (8); still under reduced motion.
  - Extension (#560): on text the pulse dips to opacity **0.75**, never lower, so ink keeps 4.5:1 at the dip (6.02 on paper, 6.26 on night, 4.91 on the light `danger-surface`); muted labels never pulse. Standing alone in the seat view, the notice is a **one-row docket** (2px ink rule, paper ground), `role="status"`: `WAITING FOR THE HOST` / `EN ATTENTE DE L'HÔTE`, `LINE CUT · RECONNECTING` / `LIGNE COUPÉE · RECONNEXION`, `NO PICTURE FROM THE ROOM · KEEP TYPING` / `PAS D'IMAGE DE LA SALLE · CONTINUE DE TAPER` (the 3D scene is off, #563), and the idle warning `THE MAJOR IS LOOKING AT YOU. TYPE.` / `LE MAJOR TE REGARDE. TAPE.` in the urgent tone: the error ground of the alert row (`danger-surface`) under ink text, never red text on Night shift (3.3).
- **HUD dockets** (extension, #560): the seat view's dockets (race card 7.4a, Sabotage tray) are themed like the lobby's (paper ground, `fg` rules: Night shift applies) and sit over the scene or the paper backdrop. Their header row puts the docket's title in the ink tag (the `YOU` tag recipe: Oswald 600 10px `.16em`, ink ground, paper text) with the mono value right (IBM Plex Mono 500 14px `.08em`), e.g. `RACE CARD` | `30 TYPISTS`.
- **Sabotage tray** (extension, #560, spec 10): a HUD docket titled `SABOTAGE TRAY` / `PLATEAU DE SABOTAGE`. The earned card is a 7.6 file card inside it (newsprint, `2px solid` ink, name Courier Prime 700 19px, effect Courier Prime 14px muted): `EXTRA PAPERWORK` / `PAPERASSE SUPPLÉMENTAIRE` (Adds words to the leader's text.), `EXEMPTION` / `EXEMPTION` (Removes words from your remaining text.), `SMOKE BREAK` / `PAUSE CIGARETTE` (Blurs the text of the typists ahead of you for a few seconds.): set dressing wording, never a joke (2). Under it the rows `PLAY` / `JOUER` | the hint (`ENTER TO PLAY`, #236) while ready, `COOLDOWN` / `RECHARGE` | `12 S` while cooling, its seconds pulsing (`lkPulse`). Empty, the 7.6 dashed empty slot: `NO CARD` / `AUCUNE CARTE`, "Cards go to the typists behind the leader." / « Les cartes vont aux dactylos derrière le premier. ». Cooling without a card shows only the cooldown row; a held card waits out the cooldown without the hint.

### 7.4a Race card (extension, #560; spec 6.2)
The seat view's "where am I in the race": a HUD docket (7.4) in the left gutter, never over the teleprinter (layout #561, #564), `RACE CARD` / `FICHE DE COURSE` | `30 TYPISTS` / `30 DACTYLOS`. Rendered from `RaceCardView = { field, lanes }` (`src/features/race/view/race-card-view.ts`); it computes nothing (ADR 0007).
- **Full-field line** under the header: a 2px ink rule with **one tick per player** at its progress (0..1). Rival ticks are 2 x 12 `rival` (ribbon-violet; the per-rival inks are #565); **yours is 6 x 18 agit-red with a 1px `fg` edge** (agit-red is 1.76:1 on the night ground: the night-ink edge carries the mark, 9.72:1). It ends in the **checkered finish**: 12 x 18, 6px squares from `repeating-conic-gradient(finish-ink 0 25%, finish-paper 0 50%)`, hard-edged, no blur (6), framed 1px `finish-ink`. `finish-ink` / `finish-paper` are the theme's ink and paper (press-ink / paper, Night shift night-ink / night). The line reads in words (`30 typists on the line, you at 61%`).
- **Lanes**: 7.4 rows `120px | 1fr` with dashed separators, in rank order: left the rank (mono 500 14px, `04`) and `DESK 07` / `BUREAU 07` (the roll-row desk label); right the name (mono 15px, ellipsis), then the ink `YOU` / `TOI` tag on your lane, then the status label, and under them a hairline track (`border`) ending in a 2px ink post, the lane's **marker riding it** at its progress. Markers are inline SVG in a 12-unit box, `rival` fill (yours `you`) with a 1.5 `fg` stroke: **circle, square, triangle, diamond** (R80: shape plus desk number, colour never alone). Your name takes the red text role (`link`: red on paper, night-ink on Night shift). Status labels: an Oswald 10px `.16em` tag in a 1px muted hairline: `LINE CUT` / `LIGNE COUPÉE`, `ASLEEP AT DESK` / `ENDORMI AU BUREAU`, `REASSIGNED` / `RÉAFFECTÉ`, `FILED` / `CLASSÉ` (finished); typing shows none. Each lane reads in words: `Place 4, Lynx-785, desk 05, 41% typed, LINE CUT` (yours adds `YOU` after the name).
- **Lanes shown** (spec 6.2, selected by #564): every player up to 8; above 8 the top 3, the two just ahead of you, you and the two just behind.
- **Compact** (tablets and small laptops, about 208px wide): rows `84px | 1fr`; names go (they stay in the lane's words), markers, desk numbers, statuses, `YOU` and the field line stay.

### 7.5 Tabs
Stardos 700 13px `.12em`. Active tab = ink bg, paper text. A 7px red dot marks tabs that contain NEW items. ←/→ keyboard switches tabs.

### 7.6 Item card (locker)
- Min-height 118px. Code `H-01` (mono 11px muted), name (Courier Prime 700 21px), sub-tag (Oswald 10px muted).
- **Equipped:** `#FFFAEE` bg, `3px solid ink`, red `ISSUED` mini stamp bottom-right (slams in).
- **Owned:** `rgba(255,250,238,.6)`, `2px solid rgba(42,36,32,.35)`.
- **Locked:** `2px dashed rgba(62,58,120,.6)`, name at 55% opacity, violet `🔒︎ LOCKED`, the requirement in violet, and a 5px violet progress bar. Clicking a locked card **shakes** it (0.4s) and puts it on in the **fitting room** (preview only).
- **New:** red `NEW` tag.
- Extension (#15): an empty state (nothing filed yet) borrows the locked card's dashed rule: `2px dashed` hairline ink (`border` role), centred title in ink, description muted, one next-step button.
- Hover: lift `translate(-2px,-2px)` with `box-shadow:4px 4px 0 ink`.

### 7.7 Typing strip ("try the keys" and the in-race telex)
- `tape-paper` bg, `2px solid ink`, inner sepia shadow, IBM Plex Mono.
- **Character states:** done = **ink** · wrong = **red** text on `rgba(184,29,36,.12)` · **next = red cell with paper text, blinking** (caret keyframe: 50% red block / 50% violet text with a 4px red underline, `steps(1)`, 1.05s) · remaining = **violet at 55%**.
- Each newly typed character pops in (`scale 1.6 → 1`, 0.18s).
- A transparent `<input>` sits over the strip to capture typing. Paste is disabled in races.
- On completion a stamp slams in: zero errors gives `ACCEPTED · {wpm} WPM`, otherwise `RETURNED · {n} ERRORS`. WPM = (chars/5)/minutes.
- Practice sentence: EN `Type fast. Type first.` · FR `Écris vite. Écris le premier.`
- In the race (extension, #558): the same strip at the full typing size (28–36px), one line that never wraps and cannot be selected. The tape holds still while the next character sits between 20% and 70% of its width; once it leaves that band the tape moves so the character lands at 30% (more text ahead stays in view, and the tape moves in steps, not on every key). It glides (`scroll-behavior: smooth`) and jumps under reduced motion. Finished, it shows the end of the text. The strip is a group named for assistive tech; its glyphs are `aria-hidden` (the input and the announcements of the race HUD carry the text).

### 7.7a Teleprinter machine and typed sheet (extension, #558)
The seat view's typing surface (spec 6.1, 14.3) is three HTML parts in this order: the **telex strip** on top (7.7), then the **typed sheet** rising out of the machine's slot, then the **machine**. All three are rendered from one view model (`TypedView`: chars and their states, cursor, jammed, last keystroke time) and hold no race rule. They are objects, the same in both themes like the tape (3.2); on a UI page they sit on a **paper backdrop** (the paper plate of `/design`). The machine is the owner's choice of 2026-10-09 (option E4 over the desk typewriter of 11.1): a **compact teleprinter**, 620px wide at 1280 x 800 (about 48% of the width) and low (a 64 top panel plus a key deck of about 200), so the Major and the rival desks stay visible above it. The 11.1 desk machines are 3D set dressing and keep their look.

**Colours (no new hex):** the invariant machine-neutral family, the same in light and Night shift: `machine-paper` = paper (top panel, key legends) · `machine-deck` = newsprint (key deck, dial finger holes) · `machine-ink` = press-ink (caps, rules, slot, hubs, plate ground, space bar) · `machine-metal` = backroom-grey (reel flange, dial ring, key stems, disabled outlines; decoration, 3.36:1 on the deck) · `machine-muted` = backroom-grey 60% with press-ink (disabled legends, 5.38:1 on the deck). Text pairs: legends `machine-paper` on `machine-ink` 12.58:1, the plate `tape` on `machine-ink` 11.25:1, the wrong-key legend `machine-paper` on `typing-error` 5.33:1. A skin maps these roles (plus `tape` and `typing-error`) to private properties once; a skin needing another colour adds a `machine-*` role, never a raw value. The sheet is `sheet` = paper in both themes.

**Typed sheet:** `sheet` paper, `2px solid ink`, hard `4px 4px 0 ink` offset, no radius, padding `14px 22px 30px` (the bottom clears the slot). It shows only what has been typed plus the caret cell (`chars[0..cursor]`, never the text still to type), in IBM Plex Mono at the compact size (`clamp(20px,2.2vw,30px)`), three lines visible: the newest line sits just above the slot, older lines leave over the top. Lines break after a word and its spaces (no-break spaces of French typography hold). Done = ink · wrong = red with a red `×` typed over it (an overstrike, no tint: the tint is the tape's) · next = the 7.7 red cell with `fcCaret` · the last typed character pops (`fcPop` 0.18s, replayed when the same position is retyped). It is 61% of the machine's width (380 of 620), centred over the slot, and its bottom 22 machine units go into the slot: the machine comes later in the DOM and is positioned, so it paints over the sheet's bottom edge.

**Teleprinter** (drawn in CSS and inline SVG, no raster). Sizes are in **machine units**, 1/620 of the machine's width (`width: min(620px, 100%)`, container units), so the numbers read as px at full size and the machine shrinks whole: nothing overflows a 375 phone (legends get small there; the seat view is tablet+).
- **Top panel** 620 x 64: `machine-paper`, `2px solid` ink. At its top edge the ink **slot**, 400 x 8, centred and covering the top rule: the sheet comes up out of it (no platen, no roller). Left, the **tape reel** (diameter 50, at 20 from the left and 5 down; in a 52-unit drawing a `machine-metal` flange r 25 with a 2-unit ink stroke, the `tape` wound tape r 17, an ink hub r 5) and a short **tape stub** 60 x 12 running right from it (`tape`, a 1.5-unit ink rule, open at the reel). Right of centre, the **maker's plate** `FIFTH COPY · MODEL 5` (84 from the right, 19 down; `machine-ink` ground, `tape` text in the label role at 11, padding 5 x 12): an in-world nameplate, never translated. Right, the **rotary dial** (diameter 52, at 18 from the right and 5 down; in an 80-unit drawing a `machine-metal` ring r 37 with an ink stroke, ten `machine-deck` finger holes r 5.5 on a radius of 29 every 30° from 60° to 330°, an ink hub r 15 and an ink finger stop in the gap).
- **Key deck** under it, sharing the panel's rule: `machine-deck`, `2px solid` ink, a hard `6px 6px 0` ink offset, padding 14 top and bottom. The key bed tilts about **22°** away from the typist (`perspective(560 units) rotateX(22deg)`, hinged at its near edge: the back rows recede); the space bar sits 12 below it. Keys come from the `rows` the machine is given (a layout is data, #224): pitch 42 (caps 30 x 28, 12 between keys, 9 between rows), each row a **quarter pitch** right of the row behind it; a longer layout shrinks the pitch so the bed stays within 560. Caps are **square** (no radius: 7.4 holds, no exception): `machine-ink` in a `2px` ink rule, `machine-paper` legends in the label role (Oswald 600 caps) at 12, and a `machine-metal` stem 3 under each cap. The **space bar** is 300 x 16, ink, on the same stem. No function keys. With four rows the deck is about 200 tall.
- **Key states** (attributes from props only, the space bar included; none animates here, the press and the wrong-key motion are #224): pressed = the cap 2 units down onto its stem (the stem shrinks to 1) · wrong = that one cap `typing-error` with a `machine-paper` legend (one cell, never the deck, 8) · disabled = a transparent cap in a dashed `machine-metal` outline (the deck shows through) with a `machine-muted` legend, its stem kept.
- **Jam** (Block mode, spec 4.3): every key outline, the space bar and the slot turn `typing-error`, and a red **X** (28 units, two 4-unit strokes, square ends) stands at the printing point just under the slot, so the jam reads without colour. Caps and panel keep their colours, so a jam toggling several times a second swings little luminance (flash rule, 8). The jam wins over disabled.
- The whole machine is decoration (`aria-hidden` root, keys are `role="presentation"` spans, no `<button>`).

**Skins (the seam):** `TypingMachine({ rows, pressed, wrong, jammed, disabledKeys, skin })` draws the registered skin named by `skin` (default `teleprinter`) inside one frame that owns the root attributes (`data-machine`, `data-skin`, `data-jammed` while jammed, `aria-hidden`); every skin renders each key of `rows` as `<span role="presentation" data-key>` with `data-pressed`, `data-wrong` and `data-disabled` from the props, and may add one `data-key=" "` space bar. Motion (#224), the jam (#220), the seat layout (#561) and a skin picker (#638) hook onto these attributes, never onto a skin. **Recipe for a new skin:** a module `skins/<id>.tsx` with its `skins/<id>.module.css` (colours as private `--_` properties mapped from the `machine-*` roles, `tape` and `typing-error`; a new colour = a new `machine-*` role), its id in `machineSkinIds`, one registry line, and an entry in this section with its parts, proportions, states and jam; the conformance suite then checks it unchanged. Selection and unlocks are future work (#638).

**Reduced motion** (8): the caret is a solid red cell, nothing pops, the tape jumps instead of gliding; the setting is the media query or any `data-motion="reduce"` ancestor. The machine has no motion of its own yet.

### 7.8 Live feed frame
Parallelogram frame, scanlines, top-left `● LIVE` red badge (dot blinks 1.2s `steps(2)`) plus ink chip `ROOM {n} · HH:MM:SS` (random room 100–999 and an elapsed timecode that ticks every second). Bottom-right `CAM 02 · 30/30`. Caption under it: `STREAMING · Room {n}, one of the ring rooms. Right now.` View toggle: `FREE VIEW | FIRST PERSON | AUTO`.
- **The live feed is a recorded video loop of the reference scene** (`Fifth Copy Full Lobby.html`, #552), not a real-time 3D embed: no WebGL scene keeps rendering on the landing (school Chromebooks first, 12). One seamless loop per view, 576x720 at 30 fps, MP4 (H.264) then WebM (VP9), each <= 1.5 MB, plus a WebP poster (frame 0 of AUTO, <= 120 kB) under `public/media/live-feed/`: **FREE VIEW is a slow orbit loop** (one full overview orbit in 16 s, the scene's `?orbit=16`), FIRST PERSON the seat POV (12 s), AUTO overview 11 s then POV 5 s (the 22 s / 10 s rhythm of 11.3, halved). The camera paths are periodic; a 15-frame crossfade hides the actors at the seam (AUTO's seam is its POV-to-overview cut). The scene's CSS post (filter and vignette, 11.2) is baked into the frames; the film grain is not (the frame's scanlines carry the texture). The video is decorative (`aria-hidden`, muted, inline, no controls), loads nothing until it is within 320px of the viewport, downloads only the selected view, pauses off screen, and under reduced motion (8) never plays and shows the poster. Re-record with `npx tsx scripts/record-live-feed.ts` whenever the scene changes (`--check` validates without recording).

### 7.9 Cursor
- Page cursor: a 22px **red star** with an ink outline (SVG data URI, hotspot 11 11).
- Over buttons and links: the same star in **gold**.
- Inside text inputs and the typing strip: the native text cursor.
- The data URI must use real quotes inside `<style>` (no `&quot;`), and `#` encoded as `%23`.

### 7.10 Layout
- Page gutters 48px desktop, 32px header. Sections 80–130px vertical padding.
- Fluid only: `flex-wrap` and `grid repeat(auto-fit, minmax(240px,1fr))`, never fixed widths on text boxes.
- Section rhythm: paper → newsprint → paper, separated by 2px ink rules. One ink band, then a red final-CTA band, then the ink footer.

### 7.11 Nixie counters (extension, #560; spec 6.1)
The seat view's counters, top right: **WPM** (clean WPM, ADR 0016) and **place** `04 / 30`. The only nixie glow in the product (0).
- A **device bezel** (6 device glow): `2px solid` backroom-grey (`room`), press-ink interior (`device-bezel`), padding 8 x 10, holding two **tubes** side by side (gap 12), each with its Oswald tag under it: `WPM` / `MPM`, `PLACE` / `RANG` (10px `.2em`, `band-muted` on the bezel, 9.03:1, no glow).
- A **tube** is the art-direction print page's nixie: a glass envelope with a rounded top `16px 16px 5px 5px` (the HUD's one rounded shape: glass, not a card), `2px solid device-nixie-glow` rim, press-ink inside with `box-shadow: inset 0 0 12px device-nixie-glow`; numerals VT323 (`type-device`) at 42px, line-height 1, in the nixie colour with `0 0 6px currentColor` (the scoped `device-nixie` utility). `device-nixie-glow` = the nixie colour at 35%, the same in both themes (a device, 3.2); never gold (gold is the reward role).
- **Numbers**: zero-padded to two digits (`07`, `04 / 30`, `00 / 30` before the start), WPM capped at `999`, larger fields keep their digits (`02 / 100`). Read in words through the bezel (`Words per minute 42, place 4 of 30` / `Mots par minute 42, rang 4 sur 30`); the glyphs are hidden.

---

## 8. Motion (UI)

All motion is short, mechanical and printed-feeling: stamps slam, paper pops, levers snap. No floaty easing on UI except gentle idle bobbing.

| Name | Spec |
|---|---|
| `fcCaret` | 1.05s `steps(1)` infinite, next-letter cell |
| `fcPop` | 0.18s (letters) / 0.35s (stamps), `scale(1.6)→(0.92)→(1)` |
| `fcSlam / lkSlam` | 0.3–0.45s, scale 2.2 → 0.9 → 1 with rotation −14° → −8° (the `Stamp` primitive: 350ms, from its angle − 8° to its angle, opacity 0 → 1 once; #26) |
| `fcBlink` | 1.2s `steps(2)`, live dot |
| `fcMarquee` | ticker, 36s linear infinite, two identical halves, translateX 0 → −50% |
| `fcSpin` | stars, 14–90s linear |
| `fcBob` | stamps on media, 4s ease-in-out, ±8px with ±3° |
| `lkShake` | 0.4s horizontal shake for denied actions |
| `lkPulse` | 1.2–1.4s opacity pulse for live/unsaved indicators (on text it never dips below 0.75, 7.4, #560) |
| Dice | the random button's icon spins 0.4s |

Respect `prefers-reduced-motion`: disable marquee, spins, bob and caret blink (show a solid red cell instead).

**Motion setting, tokens and flash rule (#28).** One setting: `prefers-reduced-motion: reduce` or `<html data-motion="reduce">`; both stop every animation above (no `!important`) and zero the UI duration tokens `--motion-duration-{fast 120ms, base 200ms, slam 350ms, slow 600ms}` (`docs/design/tokens.css`), which every UI transition and new micro-motion reads; the keyframes in the table keep their seconds. Flash safety: no element changes luminance more than three times in any one second, no flash covers more than 25% of the viewport, never a full-screen flash; loops prefer transform to opacity or colour. Under reduce the bulb (11.1) burns steady, the orbit camera (11.3) holds the static overview, stamps and medals appear without the slam. 3D pages read the same setting (the media query natively, `data-motion` through the embed bridge, section 15) and never own it. Details and consumers: `docs/design/components.md` "Motion".

---

## 9. 3D — global rules

- Engine: **three.js r184** (pinned importmap). Plain `<script type="module">` pages, embedded via `<iframe>` in UI pages.
- **Look:** flat **Lambert**, slightly chalky, like painted wooden toys. **Vertex colours** with one material per merged mesh. PBR (`MeshStandardMaterial`) only for **brass/gold and glass** (medal, special items).
- **Geometry vocabulary:** spheres, capsules, lathes, low-segment cylinders, tori. Rounded and chubby. **No boxy characters.** Boxes are fine for furniture.
- **Every character and prop is built from primitives, merged into one indexed BufferGeometry with a `color` attribute** (see `merge()` in the reference). Lathe winding is normalised to face outward so `FrontSide` works.
- **Red in 3D = flags only.** The player's identity colour lives on the **scarf** (teal by default; per-player tint via instance colour / `tintMask`).
- Lighting is from the room, never from the UI. Text is **never** rendered in WebGL (except baked medal engravings). All HUD text is HTML.

---

## 10. Characters

### 10.1 The Clerk (player avatar)
Proportions (units ≈ metres, feet at y=0, facing +z):
- **Body:** a pear lathe. Profile `[[0,0],[.17,.01],[.25,.07],[.285,.17],[.275,.27],[.24,.36],[.17,.43],[.08,.47],[0,.48]]` at y=0.16, z-scale 0.88. Shirt colour.
- **Clothes layer:** the same profile ×1.06 (vest/cardigan open at the front by a gap angle; jacket ×1.08, closed).
- **Head:** sphere R=0.22 at (0, 0.80, 0.02), scale (1.06, 0.96, 1), **sunk into the shoulders (no neck)**. Nose sphere 0.19R. Ears 0.16R (hidden under the ushanka).
- **Eyes:** white ellipsoids (0.15R) + black pupils (0.075R) + white glint. Pupils and glint live in a separate `eyes` group. Skin-coloured `lids` (0.17R) are scaled to blink.
- **Brows:** hair-coloured capsules, tilted ±0.15.
- **Mouth:** a half-torus smile (hidden by the full beard).
- **Arms:** stubby. Pivot at (±0.25, 0.50, 0), rest rotation z ±0.35. Sleeve capsule r .062, hand sphere r .058 at −0.20. **Arms are rigid: they rotate at the shoulder, never stretch** (except the seated typing rig, below).
- **Legs:** capsules r .08. Feet are flattened spheres (1, .6, 1.35).
- **Scarf:** torus r .12, tube .045, `#2E8C8A` (identity colour slot).

Base colours: skin `#F0C6A2` · eye white `#F6F1E6` · black `#161616` · shirt `#E6DCC6` · trousers `#55544E` · shoe `#241914` · brass `#B8933F`.

**Customisation catalogue** (ids are stable API, don't rename):
| Cat | id → EN / FR · tag | Notes |
|---|---|---|
| hair | `side` Side part / Raie de côté · CLERK STANDARD | 3-piece: crown cap + tilted side fringe + back taper |
| | `buzz` Buzz cut / Coupe rase · BARRACKS | |
| | `quiff` Quiff / Banane · DANCE HALL | locked: 50 WPM club |
| | `bowl` Bowl cut / Coupe au bol · HOME-MADE | hides brows |
| | `bald` Bald / Chauve · POLISHED | locked: 100% accuracy race |
| glasses | `round` Round wire / Rondes en laiton · BRASS FRAME | brass torus rims + bridge |
| | `dark` Dark lenses / Verres fumés · NIGHT SHIFT | locked: win 10 races |
| | `square` Square frames / Monture carrée · ACCOUNTANT | NEW |
| | `monocle` Monocle · OLD MONEY | locked: first win |
| | `none` | |
| hat | `none` · `ushanka` Chapka · WINTER ISSUE (locked: 7-day streak) · `kepka` Flat cap · FACTORY FLOOR (NEW) · `eyeshade` Visière · NIGHT SHIFT · `beret` Béret · ARTIST UNION (locked: accent master) | |
| clothes | `vest` Knit vest `#5E6140` gap 1.0 · `cardigan` `#7A5638` gap .55 · `jacket` Work jacket `#34405A` closed (locked: Officer) · `sweater` `#8A8C85` · `braces` Shirt & braces | sleeves take the clothes colour (vest/braces keep shirt sleeves + black garters) |
| face | `stache` Moustache · `clean` Clean shave · `beard` Full beard (locked: Commissar) | |
| hairCol | `#4A3526` Chestnut/Châtain · `#1E1A17` Ink/Encre · `#A4552A` Copper/Cuivre · `#C9A465` Wheat/Blé · `#8C8A84` Ash/Cendre | also colours brows, moustache and beard |

An outfit is a config object `{hair, glasses, hat, clothes, face, hairCol}`. Send **only this config** over the network, never meshes.

**Budgets:** LOD0 1,922–2,958 tris (default 2,650), ≤ 2,400 verts. LOD1 ≈ 850 tris (half segments, details < 9 cm dropped). New items: ≤ 300 tris each; the heaviest outfit stays ≤ 4,000.

### 10.2 Clerk animation
**Idle/attention (landing and locker widget):**
- Head yaw follows the cursor (`x·0.75`, pitch `y·0.4`, ease rate 5). The body turns `x·0.25`.
- **Eyes lead the head:** pupils offset up to ±0.012 / ±0.008, ease rate 16–18.
- Breathing: body x-scale ±0.8% at 1.6 rad/s.
- **Blink:** every 2–5s, 150ms (lid scale.y sine, pupils squash 90%).
- **Gestures every 3–6s** (random): `wave` 2.0s, `stretch` 2.2s (arms up, +5% height, head back), `look` 2.4s (left then right), `salute` 1.8s, `scratch` 2.0s. Gestures partially override cursor-follow (`lock` weight).
- **Click (landing):** `hop` 2.2s. Squash, jump 0.22, swap the uniform **at the apex**, land squash, finish with a salute.
- **Click (locker):** wave. **Outfit change:** `tryon` 0.55s squash-and-stretch bounce.

**Seated typing rig (game):**
- Constants: `ARM_L 0.33, SEAT 0.26, ROOT_Y 0.10, DESK_Y 0.44`. Thighs horizontal, shins down. Arms are aimed with `setFromUnitVectors(down, dir)` and may scale 0.8–1.35 to reach keys (the only place arms stretch).
- Keys: 4 rows × 10, `x=-0.15+c·.033+r·.008, y=DESK_Y+.062+r·.014, z=.34+r·.03`. Left hand takes columns 0–4, right hand 5–9.
- Rhythm: 5 keys/s (×speed). Per key: travel 0–40%, press 40–75% (dip 3cm), carriage steps 0.009 left at 55–75%.
- **Line = 28 keys**, then a **carriage return of 1.1s**: the left hand reaches the lever (35%), pushes the carriage back (35–80%), returns home. The head looks at the lever.
- Body bob 4mm on each press. Head: **mostly still**. Glance every **2–3s**, hold **1s**, ease rate 4 (natural). Targets are keys / paper / left / right / room. 60% of glances trigger a blink.
- Ink line grows on the paper per key. The paper advances 22mm per line and resets after 7 lines.
- **Rig split for the game:** body, head, armL, armR, eyes, lids = **6 rigid parts per clerk**, all in **one BatchedMesh** (1 draw call for every clerk) + InstancedMesh for carriages and paper.

### 10.3 The Major
- The same chubby language, **scale 1.12× a clerk** (bigger, not huge). He **stands**. There is no desk.
- Colours: olive tunic `#5B5E3C`, dark olive `#3F4229`, boots `#161514`, skin `#EBC09C`, grey hair/moustache `#9A978E`, belt `#3A2A1C`, gold `#E2B23A`.
- Kit: puffy breeches, tall black boots, brown belt with brass buckle, brass buttons, gold shoulder boards and collar tabs, two ribbon-bar rows (gold, violet, green, cream) + 2 medals + a gold hero star, gold cuffs. Beady eyes, angry grey brows, a walrus moustache, a brass monocle with chain. **Huge peaked cap:** olive crown, gold braid, black visor, gold star. **No red on him.**
- Arms rest at his sides over the belly (pivot ±0.29, 0.8).
- **Idle:** breathing; head scans the ring (targets −0.6…0.6 rad), stares 2.5–5s, then moves on. The platform turns at 0.06 rad/s, so he watches everyone.
- **Actions every 4–8s** (random):
  - **Smoke** (3.8s): the cigarette is always in his left hand (ember breathes, faint wisp). Raise to mouth 0.8s, hold 1.2s (ember brightens), lower, then exhale a puff cloud.
  - **Pour & drink** (8.5s): right hand to bottle, lift, tilt 1.9 rad over the glass (stream on, glass fills), bottle back, glass to mouth, head back −0.35, drink empty, glass down. The head looks at the table during the pour.
- Smoke = 16 pooled lambert spheres (fixed cost).

---

## 11. The Ring Room (3D environment)

### 11.1 Layout
- Round room: wall radius **10**, height **5.5**. **30 desks** in one ring at chair radius **6.9**, all facing the centre (`rotation.y = angle + π`). Desk width 1.2 (gap ≈ 0.12).
- Each station: dull steel desk (`#7D8A83` top, `#5C6660` pedestal), modesty panel, wooden chair (`#4E3424`), dark green typewriter (`#2F3A2E`) with 40 cream keys (`#E8DCC0`), side frames, animated carriage and paper. Random clutter per desk: ashtray with a butt, paper stack, tea glass in a brass holder, ink stamp.
- **Walls:** grey-green `#949A8E`, wainscot `#63655B`, trim `#52534A`, 10 pillars `#80857A`, ceiling `#55574F`. Floor concrete `#77746C` with 16 radial seams and a worn inner circle `#837F76`.
- **Wall slots** (10 positions): portrait frame (brass frame, dark painting) at slot 0 · **4 red flags with gold emblem** at slots 2, 3, 7, 8 · filing-cabinet pairs at 1, 4, 6, 9 · samovar side table at 5.
- **Centre platform:** radius 1.5–1.6, height 0.3, brass rim, dark top, brass footplate where the Major stands. Props: small round side table (bottle, glasses, ashtray), CRT on a crate (beige with a green MeshBasic screen `#3FA66B`, the only glow besides the bulb), document box.
- **Bulb:** cord from the ceiling, green enamel shade `#2F5A40` (light interior), a warm bulb sphere. **Hums** (±1.5–2% flicker) and **stutters off at random every 5–14s**, pattern `0, 1, 0, 0.6, 0, 1` over 0.5s.
- 31+ players: add raised tiers behind the ring (amphitheatre). Small lobbies: pull desks in.

### 11.2 Lighting & atmosphere (lighter, readable)
- Hemisphere `#D8DEE0 / #8A8270` intensity **4.2** · Ambient `#E4E0D4` **1.0** · Directional fill `#EEF2F4` **2.2** · Bulb point light `#FFD08A` **70**, distance 20, decay 1.4 at y 3.2.
- Fog and background `#4A4C47`, fog from 20 to 42.
- **Age & grime** (one tileable noise texture, triplanar in the Lambert shader, no extra draw calls): blotches, fine grain, vertical water streaks on walls, dirt creep below 1.8m, slight nicotine yellowing. **Strength 0.55.** Do not go dirtier.
- **Post (CSS layer over the canvas, near-free):** `filter: sepia(.1) saturate(.92) contrast(1.03)` · vignette `radial-gradient(ellipse at 50% 45%, transparent 62%, rgba(24,18,10,.32) 100%)` · film grain 160px noise tile, `opacity .06`, `mix-blend-mode: overlay`, jittered at 0.6s `steps(6)`.
- **Dust:** 220 warm points drifting in the bulb light. **Litter:** 45 paper scraps and butts on the floor.

### 11.3 Cameras
- **Overview / free view (projector):** slow orbit, radius 8.6, height 4.6, 0.05 rad/s, looking at (0, 0.6, 0), FOV 55.
- **Seat POV (first person):** eye at (0, 1.02, R−0.05) looking at the centre, **FOV 62°**. Hide your own clerk and your own paper (the player's sheet is the HTML layer). FOV widens to 100° until all rivals fit (≤13 players; see spec §7.2).
- **Auto (landing):** overview 22s → POV 10s, loop.

---

## 12. Performance budgets & presets

Measured: 30 clerks ≈ 51k tris mixed LOD (89k worst-case all LOD0). Room ≈ 40–60k. A full MEDIUM frame ≈ **130k tris, ≤ 50 draw calls**.

| Setting | LOW (Chromebook) | MEDIUM (default) | HIGH |
|---|---|---|---|
| pixelRatio cap | 1.0 | 1.25–1.5 | min(device, 2) |
| AA | off | MSAA | MSAA |
| LOD0 seats | nearest 6 | nearest 12 | all |
| Shadows | blob circles | 1 directional 1024 (clerks) | 2048 |
| Material | Lambert | Lambert | Standard on metal |
| Far-clerk anim | 30 Hz | 60 Hz | 60 Hz |
| Auto-resolution | on | on | on |

Hard rules: batch everything (BatchedMesh / InstancedMesh). Build outfits once per join, cached by config key. Dispose replaced geometry. No per-frame allocations in hot loops. A browser 30fps cap (energy saver / Low Power Mode / Safari iframes) is **not** a GPU limit; detect it (flat FPS across tests, low CPU ms) and tell the user.

---

## 13. The medal (reward object)

- **Hero of Paperwork:** gold disc r 0.5 (metalness .95, roughness .32) with a polished torus rim. The front has a **raised gold star with a red enamel star** inside and a gold centre boss; `HERO OF PAPERWORK` is stamped around the edge. The back reads `FIFTH / COPY`, `TYPE FAST · TYPE FIRST`, `№ 0457 · 1978`.
- Suspension ring plus a **pentagonal ribbon** (banner red with red, gold and violet stripes) and a gold clasp.
- Studio reflections from a locally built PMREM scene (no external env files). ACES tone mapping, exposure 1.05.
- Interaction: **horizontal spin only**. Drag sets velocity, inertia decays (rate 1.6). After 1.5s idle it eases into a 0.6 rad/s turn and bobs ±1.5cm. Transparent background.
- Podium medals: gold / silver / bronze variants of the same model. Profile medals are enamel pins (spec §13.4).

---

## 14. Screens

### 14.1 Landing (`Fifth Copy Landing.dc.html`)
Order:
1. **Header:** FC icon + FIFTH COPY · nav `HOW TO TYPE É Ç « »` · EN/FR · NIGHT SHIFT toggle (gold dot when on) · guest docket (name + GUEST tag) · SIGN IN.
2. **Hero:** halftone + 8° band, 4 stars. Left: kicker `MINISTRY OF TYPING · DESK 05 · 1978`, giant wordmark, tagline, pitch (`Thirty desks. One message. …`), typing strip, `QUICK RACE` + note (bots fill empty seats), `CREATE PRIVATE RACE`, code join. Right: **live feed** of the full lobby (section 7.8; in the app a recorded video loop of the scene, not real-time 3D) with a bobbing `ROOM {n} / 30 SEATS` stamp.
3. **Ticker band** (current language only, scrolling, spinning red stars).
4. **The story** (Moscow 1978, the countless ring rooms, the Major, "Somewhere, right now, a room is typing.") + the pull-quote stamp + a big faint star.
5. **Your clerk:** a sun-ray stage with a random clerk (cursor-follow, gestures, click = hop + new uniform) and a **personnel file**: name, `DESK 05 · RANK: RECRUIT`, issued uniform rows, `REISSUE UNIFORM`, `OPEN THE LOCKER →`, rank ladder.
6. **A little history:** four cards (The typing pool · Machines on file · Carbon copies · Samizdat) + a bridge line about typing FR/EN today. Keep claims general and teacher-checked.
7. **How a race runs:** 01/02/03 dockets with coloured top rules (red / ink / violet).
8. **Final call:** red halftone band, `REPORT TO YOUR DESK.` + inverted primary button.
9. **Medal showcase:** spinning medal + `DECORATION · DRAG TO SPIN` / `HERO OF PAPERWORK` + one line.
10. **Footer (ink):** 14px red top border. Columns: brand (wordmark, tagline, who it's for) · PLAY · LEARN · AEGIS CORP. Then social buttons (GitHub, LinkedIn, Discord, YouTube), the gold `BUILT BY AEGIS CORP.` stamp, and a bottom bar `© 2026 Fifth Copy · Built by Aegis Corp. · Made in Québec` + `No email. No chat. Your typing stays yours.`

Hero stars (#99, #497): the big red star sits at `bottom:24px` instead of the reference's `120px`, which lands on the actions row (stars never go over text, 6): the text column is the taller one even with the live feed beside it.

Extensions (#497), the landing in the app:
- **Embeds:** the reference 3D pages are served as-is from `/3d/lobby.html?embed=1`, `/3d/clerk.html` and `/3d/medal.html` (generated by `scripts/embeds.ts`, section 16); the clerk and the medal sit in `<iframe>`s mounted only when they come near the viewport. The live feed plays the recorded loop of the lobby scene instead (7.8, #552); `/3d/lobby.html` stays served for the lobby. three.js r184 and the two baked faces (Stardos Stencil 700, Oswald 600) are self-hosted under `/3d/vendor/` and `/3d/fonts/`: no third-party request at runtime. The iframe keeps a light `color-scheme` so Chrome leaves it transparent on Night shift. The `ROOM n / 30 SEATS` stamp sits inside the feed column (`right:6%; top:46%` of it), so it stays over the feed on phones.
- **Header:** EN/FR and NIGHT SHIFT are forms posting to server actions (they work before hydration); the choice lives in the `locale` and `theme` cookies for a year (ADR 0010, ARCHITECTURE 8.4). The guest docket only appears once a guest exists (reads never create guests, ADR 0009); until then the personnel file's name reads `UNASSIGNED` / `NON ASSIGNÉ`. The nav's guide link anchors to `#how` until the special-characters guide ships (#388).
- **QUICK RACE:** opens a public room and seats the player in it (`FINDING A ROOM…` while it opens); matchmaking into an existing open room is #128. The final-call button is the same action, inverted (7.1).
- **Typing strip:** practice only; the stamp shows the display formula WPM = (characters / 5) / minutes. Race scoring stays in the engine.
- **Phones:** sections wrap under each other; the clerk stage stacks over the file (<= 900px); small stars near headings hide (<= 768px); touch targets >= 44px.

### 14.2 Locker (`Fifth Copy Locker.dc.html`)
- **Left:** a steel locker door (`#6F736C` with inner frame `#7E8579`, 8px ink print shadow), vents, a crooked cream name tag `LOCKER № 0457`, an interior with sun rays and a hanger rail, the 3D clerk, and a brass dial. Buttons: `RANDOM ISSUE` (owned items only, dice spins), `UNDO CHANGES`, `SIGN & FILE` (red when dirty → stamp `FILED`; grey `ON FILE` when clean).
- **Right:** `FORM 5-C · UNIFORM ISSUE`, `DRESS YOUR CLERK`, collection counter `18 / 23` + bar, tabs (HAIR · GLASSES · HAT · CLOTHES · FACE), item cards (7.6), a hair-colour row on Hair/Face, the hint "Locked items can be tried on in the fitting room…", a keyboard hint, and an `UNSIGNED CHANGES` ink bar when dirty.
- **Fitting room:** hovering or clicking a locked item previews it on the clerk with a pulsing violet `FITTING ROOM · PREVIEW ONLY` tag. It is never saveable.

### 14.3 Next screens (to design using this bible)
Sign-in / sign-up (guest, username + password + one-time recovery code, GitHub, Discord) · Lobby (seat ring diagram, host settings as a form, invite code/link docket, START) · Race seat view (3D POV + telex strip + nixie counters + race card + overtake stamps `ОБГОН! · OVERTAKE +1` / `ОБОГНАЛИ · PASSED −1`) · Projector view (overview + top-10 sidebar + rank plaques) · Results "Dawn report" (podium with medals pinned, full ranking, personal stats card, keyboard heatmap paper → gold → red) · Personnel file (profile/stats, enamel pins) · Settings · How to type special characters. **Reuse the components above. No new colours or fonts.**

Not found (#397): the in-world form 404, composed from the "your clerk" section (14.1 item 5). Left: a sun-ray stage (6) with **the Major** alone in 3D (10.3, `docs/design/embeds/Fifth Copy The Major.html`, served as `/3d/major.html`): breathing, head following the cursor page-wide (`fc-look`, 15), scanning and staring when left alone, leaning in on a click or `fc-stare`; no desk, no props, no cigarette or bottle (they stay set dressing of the room, 2). Right, on newsprint: kicker `MINISTRY OF TYPING · FORM 404`, H1 `ARE YOU LOST, KID?` / `T'ES PERDU, LE JEUNE ?` at the story-headline scale, a `FILE NOT FOUND` / `DOSSIER INTROUVABLE` stamp slamming in at −6° (7.3, 8; still under reduced motion), two deadpan sentences, a docket of rows `FORM | 404`, `STATUS | NOT ON FILE`, `DESK | UNASSIGNED` (7.4), then the primary stamp button `REPORT TO YOUR DESK` (to `/`) and the secondary `JOIN WITH CODE →` (to `/#play`). The header stays. Phones stack the stage over the file; the Major's `fc-look` only has a cursor on pointer devices, so phones see his idle scan.

Lobby, MVP (#107): kicker `WAITING ROOM · PRIVATE RACE`, H1 `REPORT TO YOUR DESK` (Stardos 700, section H2 scale), then the room docket (7.4: header `KGB-4821` mono 500 18px `.08em` + `ROOM CODE` tag, rows `TYPISTS | n / 30`, `STATUS | WAITING`) beside the roll (7.4 roll rows), wrapping under each other (`flex-wrap`, docket max 420px). Paper ground, gutters `clamp(16px,4vw,48px)`. The seat ring, host settings, invite docket and START come with #498 and #108.

---

## 15. Embedding protocols (postMessage, `'*'` origin in dev; lock the origin in prod)

| Message | Direction | Payload | Effect |
|---|---|---|---|
| `fc-look` | page → clerk | `{x,y}` in −1..1 relative to the clerk iframe | head/eyes follow the cursor anywhere on the page (throttled with rAF) |
| `fc-reissue` | page → clerk | — | hop + random uniform |
| `fc-setcfg` | page → clerk (`?locker=1`) | `{cfg}` | build that outfit + tryon bounce |
| `fc-clerk` | clerk → page | `{cfg}` | page updates the personnel file |
| `fc-setview` | page → lobby | `{view:'over'\|'pov'\|'auto'}` | force the camera mode |
| `fc-view` | lobby → page | `{view}` | the page reflects the current view |

URL flags: lobby `?embed=1` (pixelRatio 1), lobby `?orbit=<seconds>` (one full overview orbit in that many seconds instead of 0.05 rad/s; the live feed recorder, 7.8), clerk `?locker=1` (starts in the default outfit, click = wave).

---

## 16. Reference implementation map (bundled)

| File | What it is | Treat as |
|---|---|---|
| `Fifth Copy Landing.dc.html` | Landing page | **Reference UI**: copy layout, components, copy |
| `Fifth Copy Locker.dc.html` | Locker / customisation | **Reference UI** |
| `Fifth Copy Your Clerk.html` | Embeddable clerk (cursor-follow, gestures, blink, outfit builder `build(cfg)`, `merge()`) | **Reference 3D character code** |
| `Fifth Copy Full Lobby.html` | 30 typing clerks + Major + room, aged look, auto cameras, BatchedMesh | **Reference 3D scene and perf architecture** |
| `Fifth Copy Ring Room.html` | Room only, with view/bulb/shadow controls | room tuning sandbox |
| `Fifth Copy Medal.html` | Spinnable medal | reference reward object |
| `Fifth Copy Art Direction-print.dc.html` | 8-page art direction PDF source | mood, palette and logo origins |
| `FIFTH_COPY_SPEC.md` | Product spec | features and rules |
| `FIFTH_COPY_PERF_AUDIT.md` | Measured budgets | perf |
| `archive/3d/*` | Earlier iterations (locker 3D, typing rig, stress test with bottleneck finder, clerk v1–v4) | history and reusable code (the **stress test** is the benchmark tool) |
| `assets/*` | Older renders + the 1984 constructivist poster reference | mood only |

`.dc.html` files are self-contained HTML design components. Open them in a browser. Port them to Next.js/React components by keeping the markup and styles 1:1 and moving the logic class into hooks.

App-authored 3D pages built from these references live in `docs/design/embeds/` (`Fifth Copy The Major.html`: the Full Lobby's Major, verbatim geometry and colours, alone on a transparent stage for the not-found page). The four 3D pages are deployed verbatim as `public/3d/{lobby,clerk,medal,major}.html` by `scripts/embeds.ts` (importmap to `/3d/vendor/`, fonts to `/3d/fonts/`); `scripts/embeds.test.ts` fails when a served copy drifts from its reference. Never edit `public/3d/*.html`; change the reference and rerun `npm run embeds`.

---

## 17. Do / Don't

**Do**
- Hard ink borders (2–3px), print-offset shadows, crooked stamps, stencil caps.
- Show one language at a time, everywhere, including tickers.
- Keep characters chubby, round, short-armed, big-headed; eyes lead the head; blink.
- Keep red scarce in 3D (flags only) and meaningful in UI (action / you).
- Batch, merge, LOD, dispose. Measure on a Chromebook.

**Don't**
- No pure black backgrounds (night shift is warm grey).
- No sun rays outside character stages.
- No stretching arms in gesture animations.
- No glossy plastic on characters, no bloom, no SSAO, no real-time point-light shadows by default.
- No emoji in UI (the lock glyph `🔒︎` with a text-variation selector is the single exception), no rounded pill cards, no gradient blobs, no Inter/Roboto/Arial.
- No text inside WebGL for HUD. No mixing EN/FR on one line.
- No politics aimed at students. No jokes about drinking or smoking. Period props stay background.

---

## 18. Checklist before shipping any new screen or asset
- [ ] Uses only palette tokens (section 3) and the fonts of section 4 (four faces plus the flavour and device extension).
- [ ] EN and FR complete, one language visible at a time, Québec French.
- [ ] Night shift checked (CSS vars with light fallbacks).
- [ ] Buttons and stamps follow section 7. Motion follows section 8 and respects reduced motion.
- [ ] 3D: merged vertex-colour Lambert, within the tri budget, batched, red = flags only.
- [ ] Mobile/tablet reflow (fluid, wraps, no fixed text boxes). Phones = spectator only.
- [ ] Contrast ≥ 4.5:1 for text. Hit targets ≥ 44px on touch.
- [ ] Added any new decision to **this file**.
