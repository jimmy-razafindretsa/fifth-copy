# FIFTH COPY: Art Direction

Text of [`art-direction.pdf`](art-direction.pdf) (8 pages), extracted 2026-10-02 so agents can read it. The PDF stays the source of truth for visuals (moodboard images, renders, logo drawings); this file carries its words. The game spec is [`fifth-copy-spec.md`](fifth-copy-spec.md) (section 3 summarises this document).

## 1. Cover

FIFTH COPY. A typing race set in a toy-sized Soviet ministry, 1978. It is printed in red ink on cream paper, and everyone in the room types the same message.

## 2. The idea

One message arrives. Thirty typists copy it at the same time. Whoever finishes their copy first wins the medal.

- **Toy-sized:** big heads, mitten hands, oversized caps. The system is enormous and the people are small and funny. It is never grim.
- **Printed:** flat ink on paper, slight misregistration, halftone grain. Light comes from the room, not from the UI. Glow lives only inside tubes and CRTs.
- **Red and violet:** red marks authority, urgency and you. Ribbon violet marks rivals and text still to type: everything that is not yours yet.

Period details stay: papirosa smoke, ashtrays, vodka on the Major's desk, war-scare headlines. They are historical set dressing, not gags. The tone is a deadpan cartoon of office life.

## 3. Moodboard

- Main reference: constructivist posters (steep diagonal bands, rotated type, stars, sunburst).
- Our render: the result.
- General's outfit: the Major.
- Typewriter: hero prop.
- Medals: rewards. Army medal: podium reward.
- Round table: ring layout.
- Ribbon: violet text.
- Office: room colours.
- Packaging: props.
- Toys: character shapes.
- Character inspiration: typists.
- Stamps: feedback.
- Tubes: counters only.

## 4. Palette

| Hex | Use |
|---|---|
| `#B81D24` | headers, primary action, you |
| `#7E1015` | depth of red, bands, pressed |
| `#3E3A78` | rivals, text still to type |
| `#E2B23A` | rewards and bests only |
| `#F1E8D6` | main ground |
| `#E4D6B8` | panels, cards, walls |
| `#6F736C` | 3D room: walls, desks, steel |
| `#2A2420` | type only, never panels |

Coverage: paper 55%, red 28%, ink 10%, violet 5%, gold 2%.

**Dark theme "Night shift":** Paper becomes `#1E1B2E` (carbon night) and Newsprint becomes `#2B2740`. The reds and gold stay the same, and ink becomes Paper. Same rules, inverted ground.

Tube colours (phosphor `#5CFF8A`, nixie `#FF9A3C`) appear only inside physical devices: CRTs, nixie counters, indicator bulbs. Never on UI panels.

## 5. 3D render: POV and high view

- **Framing (your seat):** seated eye height, 62° FOV. The Major sits dead centre across the ring, your red sleeves in the bottom corners.
- **3D vs HTML:** room, typists, officer and typewriter body are WebGL. Telex strip, sheet, keys and counters are an HTML layer, so text stays sharp.
- **Race lines:** top-left docket: the whole field on one line (you in red), lanes for top 3 and the 2 around you. OVERTAKE / PASSED stamps on every change. Each rival has a muted colour + marker shape + desk number, repeated on their 3D placard and scarf.
- **Layout (the ring):** 30 desks in one ring, all facing in, the Major on a turning platform at the centre. Bigger lobbies add raised tiers behind the ring.
- **Colour blocking:** grey everywhere: dirty concrete, grey-green walls, grimy wainscot, dull steel. The only red in 3D is the flags.
- **Use (high view):** projector and spectator camera. Slow orbit; rank plaques float above heads.

> Note: the spec (section 6.2) puts the race card in the left gutter; this page says top-left docket. Open question, listed in `work/plan/fifth-copy-requirements.md`.

## 6. 3D render: small lobbies

- **Each seat is staged for its owner.** Up to 13 players, every client re-seats the rivals across the room, left and right of the Major and never behind him, so you always see all of them.
- **Overview tells the truth.** Projector and spectators see even spacing (2 players: 90° apart). The camera is offset so no desk hides behind the Major.
- **FOV grows with the lobby.** The POV widens (62° → 100°) until every rival fits. Above 13, the real ring is used and the FOV opens toward 84°. Race card: all lanes up to 8, then top 3 + the 2 around you.
- **Lighting:** a dim, cool backroom with one dirty bulb over the Major that hums and stutters off at random. Dark but always readable, fog past the ring.
- **Materials:** flat Lambert, slightly chalky, like painted wood toys. No glossy PBR except on brass and glass.
- **Props:** typewriters, ink stamps, ashtrays, samovar, vodka + shot glasses, CRTs, filing cabinets, portrait frame.
- **Budget:** ~50–75k tris, ~190–320 draw calls today. Target: instanced typists, ≤ 60 calls.

## 7. Typography

| Role | Font | Rules |
|---|---|---|
| Display | Stardos Stencil 700 | Titles, stamps, medals. All caps, +4–10% tracking. Stamps rotate −6° to +6°. Sample: "HERO OF PAPERWORK" |
| Labels | Oswald 600 | Section labels, dockets, buttons. All caps, +16–24% tracking |
| Typing text | IBM Plex Mono | The only face students type from. Mixed case, clear accents, 28–36px. Done = ink, next = red cell, remaining = ribbon violet at 55%. Sample: « Où est le café ? » Déjà 4 h 30 ; dépêche-toi ! |
| Flavour | Special Elite | Story cards, intercepted-cable headers, quotes. Never for text to type. Sample: "ASSET NIGHTINGALE MEETS AT 0400." |
| Body | Courier Prime 400/700 | Rules, descriptions, stats copy. 15–18px, line-height 1.5–1.6. Sample: "At dawn, the Major pins a medal on the fastest typist. The slowest is sent to sort files in the basement." |
| Devices | VT323 | Only inside nixie tubes and CRTs. Numbers only. Sample: 00 88 66 |

## 8. Logo

- **Wordmark:** "FIFTH" in stencil, "COPY" knocked out of a bar slanting up at 8°. The bar is always the second colour: red on paper and night, ink on red.
- **Icon: FC monogram.** The wordmark in two letters: stencil "F" on top, "C" knocked out of the same 8° bar. It reads as Fifth Copy even at 16px.
- **Rules:** tagline only when there's room. Never recolour the bar violet or gold, never straighten it, and keep clear space of one bar height around the mark.

> Brief compliance (spec section 3.4): the brief forbids AI for the name and logo. The logo drafts are AI-assisted sketches; the team must redraw the final logo by hand (card "Hand-draw the final wordmark and FC monogram").
