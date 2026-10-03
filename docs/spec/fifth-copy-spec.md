# FIFTH COPY: Official Game Specification

**Tagline:** TYPE FAST · TYPE FIRST
**Version:** 1.0 · October 2026
**Status:** Approved direction, ready for implementation
**Companion files:** `Fifth Copy Art Direction.dc.html` (+ PDF), `Fifth Copy Logo Options.dc.html`, `Fifth Copy 3D v6*.html`

---

## 0. One-paragraph summary



---

## 1. Context & goals

| Item | Value |
|---|---|
| Client | Secondary-school teacher (enseignant secondaire) |
| Users | Students aged 12–17, plus the teacher as host |
| Purpose | Practise typing in **English and French**, in class, competitively |
| Feel | Dynamic, fun, Kahoot-like: one shared moment, a big screen, loud results |
| Primary motivator | Competition: winning gives rewards; players want to win and want to see their progress |
| Lower priority | Teaching how to type special characters (é, è, ê, ç, «», œ…) |
| Lower priority | Trophies / extra gamification |

### Success criteria
1. A full class of **30+ students** can race together without lag on school laptops/Chromebooks.
2. A race can be started in **under 60 seconds** from opening the site.
3. Every student leaves a race knowing their **place, WPM, accuracy, and one thing to improve**.
4. After 2 weeks of use, a student's profile clearly shows **progress over time**.

---

## 2. World & story (kept simple for 12–17)

> **The East and the West are not fighting with guns. They fight with secrets.**
> You are a typist in a secret listening post. Every night, spy messages arrive.
> **Type them faster than everyone else in the room.**
> At dawn, the Major gives a medal to the fastest. The slowest gets sent to sort files in the basement.

| Role | In game |
|---|---|
| **You** | A typist ("Comrade [username]") at one desk in the ring |
| **The Major** | Boss on a turning platform in the centre. Monocle, clipboard, always watching. Cosmetic only, with no gameplay penalty |
| **Rivals** | Every other player or bot in the ring |
| **The message** | The race text (an "intercepted cable") |
| **The medal** | The podium reward |

**Name note:** "Fifth Copy" doesn't need lore. It simply refers to everyone typing a copy of the same message.

**Period details stay** as historical set dressing: papirosa smoke, ashtrays, vodka on the Major's desk, war-scare headlines. These are background props, never gameplay rewards or jokes aimed at students. Optional "Did you know?" loading cards link props and fictional names to real history.

---

## 3. Art direction (summary; full version in the Art Direction PDF)

### 3.1 Principles
1. **Toy-sized bureaucracy:** big heads, mitten hands, oversized caps. The system is huge and the people are small and funny. It is never grim.
2. **Printed, not glowing:** flat ink on paper, slight misregistration, halftone grain. Glow lives only inside tubes and CRTs.
3. **Red is the system:** red = authority, urgency, *you*. Ribbon violet = rivals and text not yet typed.
4. **Main visual reference:** constructivist propaganda posters (steep diagonal bands ~38°, rotated type, stars, sunbursts).

### 3.2 Palette

| Token | Hex | Use |
|---|---|---|
| `agit-red` | `#B81D24` | Headers, primary action, *you* |
| `banner` | `#7E1015` | Depth of red, bands, pressed states |
| `ribbon-violet` | `#3E3A78` | Rivals, text still to type |
| `medal-gold` | `#E2B23A` | Rewards and personal bests **only** |
| `paper` | `#F1E8D6` | Main UI ground (light theme) |
| `newsprint` | `#E4D6B8` | Panels, cards |
| `backroom-grey` | `#6F736C` | 3D room walls, desks, steel |
| `press-ink` | `#2A2420` | Type only, never panels (light theme) |
| `night` | `#1E1B2E` / `#2B2740` | Dark theme ground / panels |
| `phosphor` / `nixie` | `#5CFF8A` / `#FF9A3C` | Only inside CRTs and nixie tubes |

UI coverage target: paper 55%, red 28%, ink 10%, violet 5%, gold 2%.
**In the 3D room the only red is the flags.** The room is a dim, grey, dirty backroom with one flickering bulb, but always readable.

### 3.3 Typography

| Role | Font | Rule |
|---|---|---|
| Display | Stardos Stencil 700 | Titles, stamps, medals. All caps |
| Labels | Oswald 600 | Buttons, dockets, section labels. All caps, wide tracking |
| **Text to type** | **IBM Plex Mono** | The *only* face students type from. Mixed case, clear accents, 28–36px |
| Flavour | Special Elite | Story cards, cable headers. Never for text to type |
| Body | Courier Prime | Descriptions, stats copy |
| Devices | VT323 | Numbers inside nixie tubes and CRTs only |

Typed-text colour states: **done = ink**, **next character = red cell**, **remaining = ribbon violet at 55%**, **error = red strike / X overstrike**.

### 3.4 Logo
- **Wordmark:** "FIFTH" in stencil, "COPY" knocked out of a bar slanting up at 8°. The bar is always the second colour (red on paper and night, ink on red).
- **Icon:** **FC monogram**: stencil "F" above, "C" knocked out of the same 8° bar. It works down to 16px (favicon).
- **Rules:** tagline only when there is room; never recolour the bar violet or gold; never straighten it; clear space = one bar height.

> ⚠️ **Brief compliance:** the brief says *"pas d'IA pour le nom et logo"* (no AI for the name and logo). The name **FIFTH COPY** was chosen by the team. The logo files in this project are **AI-assisted drafts**. Before submission, the team must **redraw the final logo by hand / in their own vector tool**, using these drafts only as a sketch, or replace them.

### 3.5 Themes & devices
- **Light theme** (default, paper ground) and **dark theme "Night shift"** (night ground, same reds and gold).
- Fully **responsive** for desktop, laptop and tablet.
- **Phones: spectator only** (watch the race, standings, results; no typing).

---

## 4. Core gameplay: the race

### 4.1 Rules
1. Every participant types **the same text**.
2. **The host starts the race.** Countdown 3-2-1 (the Major stamps "НАЧАЛИ / GO").
3. Live positions are shown **in real time** (see §6).
4. A **visual indicator fires on every overtake** (you pass someone, or someone passes you).
5. The race ends when **everyone has finished**, **or** when the **timer** runs out (if a timer is set).
6. Final ranking: finish order; unfinished players are ranked by progress, then accuracy.

### 4.2 Scoring
- **WPM** = (correct characters ÷ 5) ÷ minutes.
- **Accuracy** = correct keystrokes ÷ total keystrokes.
- **Raw WPM** (including errors) is stored for stats but not shown on the podium.

### 4.3 Error modes (host chooses per race)
| Mode | Behaviour | Visual |
|---|---|---|
| **Continue** | Wrong letters are accepted, counted as errors, cursor moves on | Wrong character struck through in red (X overstrike) |
| **Block** | Cursor stays on the letter until the correct key is pressed. Every wrong press is counted | The typewriter **jams**: key bar locks red until the correct key |

Backspace: allowed in both modes (host can disable it in Continue mode).

### 4.4 Abandon
- An **"Abandon"** button is always visible during a race.
- An abandoned player is ranked last with status *"Reassigned"* and keeps their partial stats.

### 4.5 Idle kick
- **No keystroke for 60 seconds** while connected → player is **kicked** from the race (marked "Asleep at desk").
- Warning at 45 s (the Major's lamp turns to the player).
- **Disconnection is not idle** (see §7.4).

---

## 5. Lobbies & matchmaking

### 5.1 Lobby types
| Type | How to join | Notes |
|---|---|---|
| **Public (open lobby)** | Listed / matchmaking from the landing page | Anyone can join until the race starts |
| **Private** | **Room code** (e.g. `KGB-4821`) **or single-use unique link** | Each invite link works **once** and then expires |

### 5.2 Size
- **Minimum 2 participants** to start (bots count toward the minimum).
- **No maximum.** Must be tested and smooth with **30+ live players** (target: 60 tested, 100 supported).
- **No offline mode**, except racing against **bots**.

### 5.3 Landing page matchmaking
- One big button: **"Quick race"** → puts the player in a **filled lobby** of real people; empty seats are filled with **bots** so the room never feels empty.
- Secondary: **"Create private race"**, **"Join with code"**.

### 5.4 Host powers
- **Only the host can invite** others (generate code / single-use links).
- Host configures the race (§8), starts it, and can remove players in the lobby.
- **Host transfer:** if the host leaves, host role passes automatically to the next player who joined earliest (human, never a bot). Everyone sees a "New host: X" stamp.

---

## 6. Race HUD (what each student sees)

### 6.1 Seat view (POV, 3D)
- First-person from your desk: your red sleeves bottom corners, the Major centre, rivals across the room.
- **Telex strip** (top): the text to type, scrolling.
- **Typewriter** (bottom): your typed sheet + a **detailed virtual keyboard** (round keys with chrome rings, type-bar basket, spools, maker's plate) that animates on each press; wrong keys flash red.
- **Nixie counters** (top right): WPM and place `04 / 30`.

### 6.2 Race card: "where am I in the race"
- **Full-field line**: one tick per player across the whole length; you are the red tick; checkered finish.
- **Lanes**: up to 8 players shows all lanes; above 8, top 3 + the 2 players just ahead and behind you.
- Each rival has a **unique muted ink colour + marker shape** (circle, square, triangle, diamond) **+ desk number**, repeated on their 3D desk placard and scarf (colour-blind safe). **Red is reserved for you.**
- The card sits in the left gutter and **never overlaps the typewriter**; it compacts on small screens.

### 6.3 Overtake indicator
- **"ОБГОН! · OVERTAKE +1"** red stamp slams in when you pass someone.
- **"ОБОГНАЛИ · PASSED −1"** ink stamp when someone passes you.
- On the projector view: the overtaker's rank plaque flips and the Major's lamp swings to the new leader.

### 6.4 Projector / spectator view
- Overview camera orbiting the ring, top-10 sidebar, rank plaques above heads.
- Used by the teacher's big screen and by **phones (spectator mode)**.

---

## 7. 3D room rules

### 7.1 Layout
- Round room: desks in a ring, all facing the centre; the Major on a turning platform in the middle.
- 2–30 players: one ring. 31+: extra raised tiers behind (amphitheatre).
- Small lobbies: the ring shrinks (desks pull in) so rivals stay close.

### 7.2 "Everyone sees everyone"
- **Seat view (≤ 13 players):** each client **re-seats rivals across the room**, spread left and right of the Major, **never behind him**, so you see all of them.
- **Overview:** shows the **true, even spacing** (2 players = 90° apart). Camera offset so no desk hides behind the Major.
- **FOV grows with lobby size:** 62° → up to 100° until every rival fits (≤ 13). Above 13 players the real ring is used and FOV opens toward 84°.

### 7.3 Performance budget
- Target 60 fps on mid laptops, 30 fps minimum on school Chromebooks.
- Instanced typists, 3 LODs + impostor cards past ~40 players, ≤ 60 draw calls.
- Auto quality preset (Low / Mid / High) from a 2-second GPU benchmark.
- **All text is HTML**, never in WebGL, so it stays sharp and input never lags.

### 7.4 Reconnection
- Temporary Wi-Fi loss → player shows **"Line cut"** on their desk; **the race continues** for everyone.
- On reconnection (grace period, e.g. 2 minutes) the player **resumes exactly where they were**; the race clock never pauses.
- If not back before the grace period ends or the race ends → ranked by progress at disconnect.

---

## 8. Host race settings

| Setting | Options |
|---|---|
| **Language** | French · English |
| **Text type** | **Real sentences** (books, films*) · **Random words** (pure speed) · **Special characters** drill |
| **Accents** | Toggle: **every word contains an accent** (FR) |
| **Length** | **Exact number of words** (e.g. 10–500) |
| **Difficulty** | Easy · Normal · Hard · Custom (word length, rare letters, punctuation density) |
| **Practice letters** | Pick specific letters to practise (e.g. `é è à ç`, or `q z x`) |
| **Include** | Numbers · Symbols · Punctuation (independent toggles) |
| **Timer** | Maximum race time (e.g. 1–10 min) **or no timer** |
| **Error mode** | Continue (errors counted) · Block until correct |
| **Bonuses** | On · Off |
| **Bots** | Number + difficulty per bot |
| **Lobby** | Public · Private |

\* **Copyright:** use **public-domain** literature (Project Gutenberg, BAnQ / Gallica for French) and **teacher-written texts**. Film quotes only if short and licensed. In-world, texts are "intercepted cables".

---

## 9. Bots

- Difficulty levels defined by **average WPM**: Recruit 20 · Clerk 35 · Officer 50 · Commissar 70 · Major 90+.
- **Never a constant rhythm:** each bot uses
  - per-character delay drawn around its target speed (random variation),
  - burst-and-pause rhythm (fast on common words, slower on long or rare ones),
  - **errors** at a level-based rate, with realistic corrections (respecting the race's error mode),
  - occasional hesitation before punctuation and accents.
- Bots run **on the server** through the same code path as players (also used for load testing).
- Bots are clearly marked (🤖-free: a small "BOT" docket on their placard).

---

## 10. Catch-up bonus system

**The further behind you are, the more and stronger bonuses you get.** The leader never gets bonuses.

| Bonus (in-world name) | Effect | Unlocks when |
|---|---|---|
| **Extra Paperwork** | Adds extra words to the **leader's** text | You are in the bottom 50% |
| **Exemption** | **Removes words** from your own remaining text | Bottom 33% |
| **Smoke Break** | **Blurs** the text of the players ahead of you for a few seconds | Bottom 25% |

- Earned automatically by position, one card at a time, shown in a "Sabotage tray" docket.
- Short cooldowns; a player can't be hit by the same effect twice in a row.
- Host can switch bonuses **off** (e.g. for a pure test).
- Stats record bonus-adjusted and clean WPM separately.

---

## 11. End of race: results ("Dawn report")

1. **Podium: top 3** with medals (gold / silver / bronze) pinned by the Major.
2. **Full ranking of all participants** (place, name, avatar, WPM, accuracy, status).
3. **Personal stats card** for each student:
   - WPM, accuracy, place, personal-best flag,
   - WPM-through-the-race graph (with dips from received bonuses marked),
   - errors by key + mini heatmap,
   - bonuses sent / received.
4. Buttons: **Race again** (same lobby), **Personnel file** (profile), **Leave**.

---

## 12. Accounts & identity

### 12.1 Account types
| Type | How | Stats |
|---|---|---|
| **Guest (anonymous)** | Automatic on first visit; random typist name (e.g. "Comrade Sparrow-482") | **Yes**, stored against a guest ID |
| **Username + password** | Sign-up form | Yes |
| **GitHub OAuth** | "Continue with GitHub" | Yes |
| **Discord OAuth** | "Continue with Discord" | Yes |

- **No email** collected. **No "forgot password".**
- **Guest → account upgrade:** when a guest creates an account, **all their guest stats and history are merged** into the new account.

### 12.2 Profile picture
- OAuth: **avatar imported automatically** from GitHub / Discord.
- Username accounts: default stamped-portrait avatar.
- **Users can change** their picture anytime (upload, cropped square, size limit, moderated by a basic filter).

### 12.3 Recommended safeguards (minors, no email)
- Show a **one-time recovery code** at sign-up (since there is no email or reset). Without it, a lost password = lost account (as specified).
- **Username filter** (profanity FR/EN), **no chat**, avatars only visible to lobby members.
- GitHub / Discord require age 13+ → students under 13 use username / guest.
- Comply with **Québec Law 25** (minimal personal data, privacy page, data deletion on request).

---

## 13. Statistics & progression (core feature)

Every user (guest included) accumulates data from every race. **Lots of stats, all designed to show improvement.**

### 13.1 Stored per race
WPM, raw WPM, accuracy, place, lobby size, language, text type, settings, duration, finish status, per-character timing and errors, bonuses.

### 13.2 Profile ("Personnel file")
| Stat | Display |
|---|---|
| **Speed over time** | Line graph of WPM per race + 7-day moving average; "+X WPM since you started" |
| **Accuracy over time** | Line graph |
| **Personal bests** | Best WPM per language / text type / length |
| **Difficult keys** | **Digital keyboard heatmap** (error rate and slowness per key) |
| **Accents & special characters** | Dedicated FR heatmap row (é è ê à ç ù œ « » …) |
| **Language split** | FR vs EN speed |
| **Activity** | Races per day, streak |
| **Rank history** | Average place, medals won |
| **Improvement callouts** | "Your 'ç' is 30% faster than last week" |

### 13.3 Keyboard heatmap
- Rendered on the **student's chosen keyboard layout**: Canadian French (CSA), French Canada, US QWERTY, AZERTY.
- Stats stored **per character**, then mapped onto the chosen layout.
- Colour: paper → gold → red (slow / error-prone). Click a key → its trend over time + "Practise this letter" (creates a race with that letter, §8).

### 13.4 Gamification (lower priority)
- **Medals / trophies:** first win, 50 WPM club, 100% accuracy race, accent master, 7-day streak, etc. Shown as enamel pins in the profile.
- Ranks by average WPM: Recruit → Clerk → Officer → Commissar → Hero of Paperwork.

---

## 14. Special characters guide (lower priority)

- A **"How to type it"** page: for each special character (é, è, ê, ë, à, â, ç, ù, û, ô, î, ï, œ, æ, « », €, …) show the key combination **per keyboard layout** and OS (Windows / macOS / ChromeOS).
- Linked from the heatmap and from errors on special characters during a race ("Stuck on ç? Here's how").
- A "Special characters" text type in host settings for drilling (§8).

---

## 15. Internationalisation

- Full UI in **French and English** (toggle in the header, remembered per user).
- Race language is **independent** from UI language (an English UI can host a French race).
- All in-world labels have both versions (e.g. "ОБГОН! · OVERTAKE / DÉPASSEMENT").

---

## 16. Technical architecture

### 16.1 Required stack
| Layer | Choice |
|---|---|
| Framework | **React + Next.js (App Router), TypeScript** |
| Styling | **Tailwind CSS** (palette and fonts as CSS variables / Tailwind theme tokens, light + dark) |
| Database | **PostgreSQL** |
| ORM | Free choice (recommended: **Drizzle** or **Prisma**) |
| 3D | three.js (WebGL2), loaded only on the race screen |
| Auth | Auth.js (NextAuth): Credentials + GitHub + Discord providers |

### 16.2 Real-time service (required for 30+ live players)
- Next.js serverless routes **cannot hold** dozens of long-lived WebSockets. Run a **separate Node real-time server** (Socket.IO or Colyseus), deployed next to the Next.js app.
- **Redis** for room state, presence, reconnection tokens, host transfer, single-use invite links.
- **Server-authoritative race:** clients send keystrokes; the server validates, computes progress and positions, and broadcasts state ~10×/s.

### 16.3 Anti-cheat
- Paste blocked; text rendered so it can't be copied.
- Server checks timing: WPM cap, inhuman regularity detection, keystroke-sequence validation.
- Suspicious races excluded from stats and leaderboards.

### 16.4 Data model (minimum)
`users` (id, username, password_hash?, avatar_url, provider, is_guest, created_at)
`oauth_accounts` (user_id, provider, provider_id)
`lobbies` (id, code, type, host_id, settings_json, status)
`invites` (id, lobby_id, token, used_at)
`races` (id, lobby_id, text_id, settings_json, started_at, ended_at)
`race_results` (race_id, user_id, place, wpm, raw_wpm, accuracy, status, bonuses_json)
`keystrokes_raw` (race_id, user_id, compressed blob; **short retention**, e.g. 30 days)
`char_stats_daily` (user_id, date, char, layout, hits, errors, avg_ms) ← heatmap reads this
`texts` (id, language, type, source, licence, content)
`achievements` (user_id, code, earned_at)

Raw keystrokes are **rolled up** into daily per-character tables so stats stay fast.

### 16.5 Hosting & delivery
- **HTTPS**, hosted on **our own site/domain** (e.g. VPS or school server with a reverse proxy + TLS from Let's Encrypt).
- **GitHub** repository with **versioning**: protected `main`, feature branches, pull requests, semantic version tags (`v1.0.0`), changelog.
- **CI/CD (GitHub Actions):** lint → type-check → unit tests → **automated E2E tests** → build → **auto-deploy** on merge to `main`.

### 16.6 E2E tests (Playwright, multiple browser contexts)
1. Guest joins quick race with bots, finishes, sees results.
2. Host creates private race; 2 students join by code; single-use link refused on second use.
3. Host leaves mid-lobby → host transferred.
4. Student disconnects mid-race → race continues → reconnects at same position.
5. Idle 60 s → kicked.
6. Block mode: wrong key does not advance.
7. Timer ends race; "everyone finished" ends race.
8. Guest stats merged after sign-up.
9. Phone viewport → spectator only.
10. Load test: 60 simulated players (server bots) in one room.

---

## 17. Screens (to design next)

1. **Landing**: Quick race · Create private race · Join with code · language + theme toggle
2. **Sign-in / sign-up**: Guest, username + password, GitHub, Discord
3. **Lobby**: player list with avatars, host settings panel, invite code/link, start
4. **Race: seat view** (3D POV + HUD)
5. **Race: projector / spectator view** (overview + standings)
6. **Phone spectator**
7. **Results: Dawn report** (podium, ranking, personal card)
8. **Profile: Personnel file** (stats, graphs, heatmap, medals, avatar)
9. **Special characters guide**
10. **Settings** (keyboard layout, theme, language)

---

## 18. Requirement traceability (brief → spec)

| # | Brief requirement (FR) | Section |
|---|---|---|
| 1 | Enseignant secondaire, élèves pratiquent le typing EN/FR | §1, §15 |
| 2 | Courses entre eux en classe | §4, §5 |
| 3 | Site dynamique, fun, 12–17, comme Kahoot | §1, §3, §6.4 |
| 4 | *(moins prioritaire)* Comment taper des caractères spéciaux | §14 |
| 5 | Compétition, gagner donne des récompenses, connaître sa progression | §10, §11, §13 |
| 6 | Course visuelle engageante, logique Kahoot | §6, §7 |
| 7 | Même texte pour tous, le plus vite possible, l'hôte démarre | §4.1 |
| 8 | Positions en temps réel comme Mario Kart | §6.2, §6.4 |
| 9 | Indicateur visuel lors d'un dépassement | §6.3 |
| 10 | Minimum 2 par lobby, pas de mode offline sauf bots | §5.2 |
| 11 | Pas de maximum, minimum 30 en live | §5.2, §7.3, §16.2 |
| 12 | Compte GitHub, Discord, username + mot de passe, pas d'email | §12.1 |
| 13 | Pas de mot de passe oublié | §12.1, §12.3 |
| 14 | Photo de profil (auto via OAuth, modifiable) | §12.2 |
| 15 | Stats de performance et progression (vitesse dans le temps, touches difficiles…) | §13 |
| 16 | Beaucoup de stats qui montrent l'amélioration | §13.2 |
| 17 | *(pas prioritaire)* Trophées | §13.4 |
| 18 | Compte invité anonyme, tous les users ont des stats | §12.1 |
| 19 | Invité peut sauvegarder ses données en créant un compte | §12.1 |
| 20 | Lobby ouvert / course publique | §5.1 |
| 21 | Course privée via code ou lien unique à usage unique | §5.1 |
| 22 | Reconnexion après perte de Wi-Fi, la course continue | §7.4 |
| 23 | Landing page avec matchmaking (gens ou bots, salon rempli) | §5.3 |
| 24 | Hôte personnalise: texte (vraies phrases, mots en désordre, caractères spéciaux, accents dans chaque mot), difficulté, nombre exact de mots, lettres à pratiquer, chiffres / symboles / ponctuation | §8 |
| 25 | Site français et anglais | §15 |
| 26 | Timer maximum optionnel; fin quand tous ont fini ou timer | §4.1, §8 |
| 27 | Kick après 1 minute sans taper | §4.5 |
| 28 | Mauvaise lettre: continuer (comptée) ou bloquer jusqu'à la bonne | §4.3 |
| 29 | Bots: niveaux par vitesse moyenne, rythme non constant, font des erreurs | §9 |
| 30 | Bonus pour ceux derrière: texte en plus au premier, moins de mots pour soi, flouter le texte des autres | §10 |
| 31 | Bouton abandonner | §4.4 |
| 32 | Top 3, participants, stats personnelles | §11 |
| 33 | Clavier digital avec heatmap des lettres difficiles | §13.3 |
| 34 | Transfert d'hôte quand il quitte | §5.4 |
| 35 | Seul l'hôte peut inviter | §5.4 |
| 36 | Direction artistique prononcée | §3 + Art Direction PDF |
| 37 | Pas d'IA pour le nom et le logo | §3.4 ⚠️ |
| 38 | Thème clair / sombre, responsive, téléphones = spectateurs | §3.5 |
| 39 | React, Next.js, TypeScript, Tailwind, PostgreSQL, ORM libre | §16.1 |
| 40 | HTTPS, hébergé sur notre site | §16.5 |
| 41 | Tests E2E, déploiement automatique | §16.5, §16.6 |
| 42 | GitHub avec versioning | §16.5 |

---

## 19. Risks & open questions

| Risk | Mitigation |
|---|---|
| 3D too heavy for school Chromebooks | LOD, instancing, auto quality presets, HTML text layer (§7.3) |
| 30+ WebSockets on Next.js | Separate real-time server + Redis (§16.2) |
| Lost accounts (no email, no reset) | One-time recovery code (§12.3) |
| Minors' data / OAuth age limits | Law 25 compliance, guest and username paths (§12.3) |
| Copyright on book/film texts | Public-domain + teacher texts (§8) |
| Wi-Fi drop vs idle confusion | Socket state decides: disconnected = grace period, connected + silent = idle kick (§4.5, §7.4) |
| Logo made with AI vs brief | Team redraws the final logo (§3.4) |
| Keyboard layout mismatch | Layout picker + per-character stats (§13.3) |

**Open questions for the teacher**
1. Is a one-time recovery code acceptable, given "no forgot password"?
2. Should the teacher get a class dashboard (all students' progress)?
3. Are short film quotes required, or is public-domain literature enough?
4. Which domain / server will host the site?

---

*FIFTH COPY · TYPE FAST · TYPE FIRST*
