# FIFTH COPY: atomic requirements

Extracted 2026-10-02 by the `build-board` workflow from `docs/spec/fifth-copy-spec.md` (v1.0) and the Art Direction PDF (`docs/spec/art-direction.pdf`, text in `docs/spec/art-direction.md`). Board cards cite these ids in their **Covers** line. The spec stays the source of truth; regenerate this list when it changes.

| Id | Kind | Requirement |
|---|---|---|
| R1 | constraint | Target users are secondary-school students aged 12-17, plus the teacher acting as race host. |
| R2 | functional | Students can practise typing in both English and French (race texts exist in both languages). |
| R3 | non-functional | A full class of 30+ students can race together in one race without perceptible lag on school laptops and Chromebooks. |
| R4 | non-functional | A race can be started in under 60 seconds from opening the site. |
| R5 | functional | After every race each student is shown their place, WPM, accuracy and one concrete thing to improve. |
| R6 | functional | After 2 weeks of use, a student's profile clearly shows their progress over time. |
| R7 | non-technical | In-world copy addresses the player as "Comrade [username]", a typist at one desk in the ring; race texts are presented as "intercepted cables" and the podium reward as the medal. |
| R8 | functional | The Major (monocle, clipboard) sits on a turning platform in the centre of the room and is cosmetic only, with no gameplay penalty. |
| R9 | non-technical | Period details (papirosa smoke, ashtrays, vodka on the Major's desk, war-scare headlines) appear only as background props, never as gameplay rewards or jokes aimed at students. |
| R10 | non-technical | Optional "Did you know?" loading cards link props and fictional names to real history. |
| R11 | constraint | Visual tone is toy-sized bureaucracy (big heads, mitten hands, oversized caps), a deadpan cartoon of office life, never grim. |
| R12 | functional | Design tokens exist for the palette: agit-red #B81D24, banner #7E1015, ribbon-violet #3E3A78, medal-gold #E2B23A, paper #F1E8D6, newsprint #E4D6B8, backroom-grey #6F736C, press-ink #2A2420, night #1E1B2E/#2B2740, phosphor #5CFF8A, nixie #FF9A3C. |
| R13 | constraint | Red is used for headers, primary actions, urgency and the current player ('you'); banner red for depth, bands and pressed states. |
| R14 | constraint | Ribbon violet is used for rivals and for text not yet typed. |
| R15 | constraint | Medal gold is used only for rewards and personal bests. |
| R16 | constraint | Press ink is used for type only, never as a panel fill (light theme). |
| R17 | constraint | Phosphor and nixie colours appear only inside physical devices (CRTs, nixie counters, indicator bulbs), never on UI panels. |
| R18 | constraint | UI colour coverage targets approximately paper 55%, red 28%, ink 10%, violet 5%, gold 2%. |
| R19 | constraint | UI looks printed, not glowing: flat ink on paper, slight misregistration, halftone grain; glow only inside tubes and CRTs. |
| R20 | constraint | UI uses constructivist-poster motifs: steep diagonal bands (~38 degrees), rotated type, stars and sunbursts. |
| R21 | functional | A dark theme "Night shift" maps paper to #1E1B2E, newsprint to #2B2740 and ink to paper, keeping reds and gold unchanged. |
| R22 | functional | Light theme is the default; users can switch between light and dark themes. |
| R23 | constraint | Display type is Stardos Stencil 700 for titles, stamps and medals, all caps, +4-10% tracking. |
| R24 | constraint | Label type is Oswald 600 for buttons, dockets and section labels, all caps, +16-24% tracking. |
| R25 | constraint | IBM Plex Mono is the only typeface used for text to type: mixed case, clear accents, 28-36px. |
| R26 | constraint | Special Elite is used for flavour text (story cards, cable headers, quotes) and never for text to type. |
| R27 | constraint | Body text uses Courier Prime 400/700 at 15-18px with line-height 1.5-1.6. |
| R28 | constraint | VT323 is used only for numbers inside nixie tubes and CRTs. |
| R29 | functional | Stamps (feedback) render rotated between -6 and +6 degrees. |
| R30 | functional | Typed text shows states: done characters in ink, next character in a red cell, remaining text in ribbon violet at 55%, errors as red strike / X overstrike. |
| R31 | non-technical | Wordmark: "FIFTH" in stencil, "COPY" knocked out of a bar slanting up at 8 degrees; the bar is the second colour (red on paper and night, ink on red). |
| R32 | non-technical | Icon is an FC monogram (stencil F above, C knocked out of the same 8-degree bar) that stays legible at 16px and is used as the favicon. |
| R33 | constraint | Logo rules: tagline only when there is room; bar never recoloured violet or gold; bar never straightened; clear space of one bar height around the mark. |
| R34 | constraint | Before submission the team redraws the final logo by hand or in their own vector tool (no AI for name and logo); AI drafts are sketches only. |
| R35 | non-functional | The site is fully responsive on desktop, laptop and tablet. |
| R36 | functional | On phones the user is spectator only: they can watch the race, standings and results but cannot type in a race. |
| R37 | functional | Every participant in a race types the same text. |
| R38 | functional | Only the host can start the race. |
| R39 | functional | Race start shows a 3-2-1 countdown ending with the Major stamping "НАЧАЛИ / GO"; typing is enabled only after it. |
| R40 | functional | Live positions of all participants are shown in real time during the race. |
| R41 | functional | A visual indicator fires on every overtake, both when you pass someone and when someone passes you. |
| R42 | functional | The race ends when every participant has finished. |
| R43 | functional | If a timer is set, the race ends when the timer runs out. |
| R44 | functional | Final ranking orders finishers by finish order, then unfinished players by progress, then by accuracy. |
| R45 | functional | WPM is computed as (correct characters / 5) / minutes. |
| R46 | functional | Accuracy is computed as correct keystrokes / total keystrokes. |
| R47 | functional | Raw WPM (including errors) is computed and stored for stats but not shown on the podium. |
| R48 | functional | The host chooses the error mode (Continue or Block) per race. |
| R49 | functional | Continue mode: a wrong letter is accepted, counted as an error, the cursor moves on, and the wrong character shows as a red strike / X overstrike. |
| R50 | functional | Block mode: the cursor stays on the letter until the correct key is pressed, every wrong press is counted, and the teleprinter jams (key outlines, the space bar and the paper slot lock red, with a red X at the printing point) until the correct key. |
| R51 | functional | Backspace is allowed in both error modes by default. |
| R52 | functional | The host can disable backspace for a race in Continue mode. |
| R53 | functional | An "Abandon" button is always visible during a race. |
| R54 | functional | A player who abandons is ranked last with status "Reassigned" and keeps their partial stats. |
| R55 | functional | A connected player with no keystroke for 60 seconds is kicked from the race and marked "Asleep at desk". |
| R56 | functional | At 45 seconds without a keystroke the player is warned: the Major's lamp turns to them. |
| R57 | functional | Disconnection is not treated as idle: socket state decides (disconnected = grace period, connected and silent = idle kick). |
| R58 | functional | Public (open) lobbies are listed/matchable from the landing page and anyone can join until the race starts. |
| R59 | functional | A private lobby can be joined with a room code (format like KGB-4821). |
| R60 | functional | A private lobby can be joined with a unique invite link that works once and then expires. |
| R61 | functional | A race needs at least 2 participants to start; bots count toward the minimum. |
| R62 | functional | Lobbies have no maximum number of participants. |
| R63 | non-functional | A race stays smooth with 30+ live players; target 60 players tested and 100 supported. |
| R64 | constraint | There is no offline mode; the only exception is racing against bots. |
| R65 | functional | A player can race against bots only, without other humans. |
| R66 | functional | The landing page has one big "Quick race" button that places the player in a filled lobby of real people, with empty seats filled by bots. |
| R67 | functional | The landing page offers secondary actions "Create private race" and "Join with code". |
| R68 | functional | Only the host can invite others (generate a room code or single-use links). |
| R69 | functional | The host configures the race settings in the lobby. |
| R70 | functional | The host can remove players from the lobby. |
| R71 | functional | If the host leaves, the host role passes automatically to the earliest-joined remaining human (never a bot). |
| R72 | functional | On host transfer every participant sees a "New host: X" stamp. |
| R73 | functional | Seat view is a first-person 3D POV from your desk: your red sleeves in the bottom corners, the Major in the centre, rivals across the room. |
| R74 | functional | A telex strip at the top of the seat view shows the text to type, scrolling as you type. |
| R75 | functional | A typewriter at the bottom of the seat view shows your typed sheet. |
| R76 | functional | Your typed sheet rises from the slot of a compact teleprinter (tape reel, maker's plate, rotary dial, a tilted deck of square keys and a space bar), one machine skin behind a stable interface with more skins later; it animates on each key press and wrong keys flash red. |
| R77 | functional | Nixie counters at the top right show your live WPM and place in the format "04 / 30". |
| R78 | functional | The race card shows a full-field line with one tick per player, your tick in red, and a checkered finish. |
| R79 | functional | The race card shows lanes for all players when there are 8 or fewer; above 8 it shows the top 3 plus the 2 players just ahead of and behind you. |
| R80 | non-functional | Each rival has a unique muted ink colour + marker shape (circle, square, triangle, diamond) + desk number, repeated on their 3D placard and scarf, so it is colour-blind safe. |
| R81 | constraint | Red is reserved for the current player in the race card and rival markers. |
| R82 | functional | The race card sits in the left gutter, never overlaps the typewriter, and compacts on small screens. |
| R83 | functional | When you pass someone, a red "ОБГОН! · OVERTAKE +1" stamp slams in. |
| R84 | functional | When someone passes you, an ink "ОБОГНАЛИ · PASSED −1" stamp appears. |
| R85 | functional | On the projector view, an overtaker's rank plaque flips and the Major's lamp swings to the new leader. |
| R86 | functional | Projector/spectator view shows a slowly orbiting overview camera of the ring, a top-10 sidebar and rank plaques floating above heads. |
| R87 | functional | The projector/spectator view is usable on the teacher's big screen and on phones (spectator mode). |
| R88 | functional | The 3D room is round with desks in a ring all facing the centre and the Major on a turning platform in the middle. |
| R89 | functional | Lobbies of 2-30 players use one ring; 31+ players add raised tiers behind the ring (amphitheatre). |
| R90 | functional | In small lobbies the ring shrinks (desks pull in) so rivals stay close. |
| R91 | functional | In seat view with 13 or fewer players, each client re-seats rivals across the room, left and right of the Major and never behind him, so all rivals are visible. |
| R92 | functional | The overview shows true even spacing (2 players = 90 degrees apart), with the camera offset so no desk hides behind the Major. |
| R93 | functional | Seat-view FOV starts at 62 degrees (seated eye height) and widens up to 100 degrees until every rival fits (13 or fewer); above 13 the real ring is used and FOV opens toward 84 degrees. |
| R94 | constraint | The 3D room is a dim grey backroom (dirty concrete, grey-green walls, dull steel) whose only red is the flags, with fog past the ring, always readable. |
| R95 | functional | One dirty bulb over the Major hums and flickers off at random. |
| R96 | constraint | 3D materials are flat Lambert, slightly chalky like painted wood toys; glossy PBR only on brass and glass. |
| R97 | non-technical | 3D props include typewriters, ink stamps, ashtrays, samovar, vodka and shot glasses, CRTs, filing cabinets and a portrait frame. |
| R98 | constraint | Room, typists, officer and typewriter body are WebGL; telex strip, sheet, keys and counters are an HTML layer. |
| R99 | non-functional | The race screen runs at 60 fps on mid-range laptops and at least 30 fps on school Chromebooks. |
| R100 | non-functional | 3D uses instanced typists, 3 LODs plus impostor cards past ~40 players, and at most 60 draw calls. |
| R101 | functional | A 2-second GPU benchmark automatically selects a Low, Mid or High quality preset. |
| R102 | non-functional | All text is rendered in HTML, never in WebGL, so it stays sharp and typing input never lags. |
| R103 | non-functional | three.js (WebGL2) is loaded only on the race screen. |
| R104 | functional | When a player temporarily loses connection, their desk shows "Line cut" and the race continues for everyone. |
| R105 | functional | A player who reconnects within the grace period (e.g. 2 minutes) resumes exactly where they were. |
| R106 | functional | The race clock never pauses for disconnections. |
| R107 | functional | A player not back before the grace period ends or the race ends is ranked by their progress at disconnect. |
| R108 | functional | Host setting: race language French or English. |
| R109 | functional | Host setting: text type Real sentences, Random words, or Special characters drill. |
| R110 | functional | Host setting (French): toggle so that every word in the text contains an accent. |
| R111 | functional | Host setting: exact number of words in the text (e.g. 10-500), and the generated text has exactly that count. |
| R112 | functional | Host setting: difficulty Easy, Normal, Hard or Custom. |
| R113 | functional | Custom difficulty lets the host set word length, rare letters and punctuation density. |
| R114 | functional | Host setting: pick specific letters to practise (e.g. é è à ç or q z x), and the text emphasises them. |
| R115 | functional | Host setting: independent toggles to include numbers, symbols and punctuation. |
| R116 | functional | Host setting: maximum race time (e.g. 1-10 minutes) or no timer. |
| R117 | functional | Host setting: bonuses on or off. |
| R118 | functional | Host setting: number of bots and a difficulty per bot. |
| R119 | functional | Host setting: lobby type public or private. |
| R120 | non-technical | Real-sentence texts come from public-domain literature (Project Gutenberg, BAnQ / Gallica for French) and teacher-written texts, with source and licence recorded per text. |
| R121 | constraint | Film quotes are used only if short and licensed. |
| R122 | functional | Bot levels are defined by average WPM: Recruit 20, Clerk 35, Officer 50, Commissar 70, Major 90+. |
| R123 | functional | Bots type with per-character delays drawn randomly around their target speed (never a constant rhythm). |
| R124 | functional | Bots use a burst-and-pause rhythm: fast on common words, slower on long or rare ones. |
| R125 | functional | Bots make errors at a level-based rate with realistic corrections that respect the race's error mode. |
| R126 | functional | Bots occasionally hesitate before punctuation and accents. |
| R127 | constraint | Bots run on the server through the same code path as human players. |
| R128 | functional | Server bots can be used to load-test a room with many simulated players. |
| R129 | functional | Bots are clearly marked with a small "BOT" docket on their placard (no emoji). |
| R130 | functional | Catch-up bonuses: the further behind a player is, the more and stronger bonuses they get; the leader never gets bonuses. |
| R131 | functional | Bonus "Extra Paperwork" adds extra words to the leader's text; unlocks when you are in the bottom 50%. |
| R132 | functional | Bonus "Exemption" removes words from your own remaining text; unlocks in the bottom 33%. |
| R133 | functional | Bonus "Smoke Break" blurs the text of players ahead of you for a few seconds; unlocks in the bottom 25%. |
| R134 | functional | Bonuses are earned automatically by position, one card at a time, and shown in a "Sabotage tray" docket. |
| R135 | functional | Bonuses have short cooldowns. |
| R136 | functional | A player cannot be hit by the same bonus effect twice in a row. |
| R137 | functional | Stats record bonus-adjusted WPM and clean WPM separately. |
| R138 | functional | Results ("Dawn report") show a podium of the top 3 with gold, silver and bronze medals pinned by the Major. |
| R139 | functional | Results show the full ranking of all participants with place, name, avatar, WPM, accuracy and status. |
| R140 | functional | Each student's personal stats card shows WPM, accuracy, place and a personal-best flag. |
| R141 | functional | The personal stats card shows a WPM-through-the-race graph with dips from received bonuses marked. |
| R142 | functional | The personal stats card shows errors by key with a mini heatmap. |
| R143 | functional | The personal stats card shows bonuses sent and received. |
| R144 | functional | Results offer buttons Race again (same lobby), Personnel file (profile) and Leave. |
| R145 | functional | A guest (anonymous) account is created automatically on first visit with a random typist name (e.g. "Comrade Sparrow-482"). |
| R146 | functional | Guest stats are stored against a persistent guest ID. |
| R147 | functional | Users can sign up with a username and password. |
| R148 | functional | Users can sign in with username and password, stay signed in across visits via a session, and sign out. |
| R149 | non-functional | Passwords are stored only as secure hashes. |
| R150 | functional | Users can sign in with "Continue with GitHub" (OAuth). |
| R151 | functional | Users can sign in with "Continue with Discord" (OAuth). |
| R152 | constraint | No email address is collected anywhere. |
| R153 | constraint | There is no "forgot password" flow. |
| R154 | functional | When a guest creates an account, all their guest stats and history are merged into the new account. |
| R155 | functional | OAuth users get their avatar imported automatically from GitHub or Discord. |
| R156 | functional | Username accounts get a default stamped-portrait avatar. |
| R157 | functional | Users can change their profile picture anytime by uploading an image, cropped to a square, within a size limit. |
| R158 | non-functional | Uploaded avatars are checked by a basic moderation filter. |
| R159 | functional | A one-time recovery code is shown at username sign-up; without it a lost password means a lost account. |
| R160 | functional | A user can redeem their one-time recovery code to regain access to their account (implied by R159). |
| R161 | non-functional | Usernames are checked by a French and English profanity filter. |
| R162 | constraint | There is no chat feature. |
| R163 | non-functional | Avatars are visible only to members of the same lobby. |
| R164 | constraint | GitHub/Discord require age 13+; students under 13 are directed to username or guest accounts. |
| R165 | constraint | The app complies with Québec Law 25: only minimal personal data is collected. |
| R166 | non-technical | A privacy page explains what data is collected and how it is used (Law 25). |
| R167 | functional | A user's data can be deleted on request (Law 25). |
| R168 | functional | Every user, guests included, accumulates stats from every race they play. |
| R169 | functional | Stored per race result: WPM, raw WPM, accuracy, place, lobby size, language, text type, settings, duration, finish status, per-character timing and errors, bonuses. |
| R170 | functional | Profile ("Personnel file") shows a WPM-per-race line graph with a 7-day moving average and "+X WPM since you started". |
| R171 | functional | Profile shows an accuracy-over-time line graph. |
| R172 | functional | Profile shows personal bests: best WPM per language, text type and length. |
| R173 | functional | Profile shows a digital keyboard heatmap of error rate and slowness per key. |
| R174 | functional | Profile heatmap has a dedicated French accents/special characters row (é è ê à ç ù œ « » ...). |
| R175 | functional | Profile shows a language split of French vs English speed. |
| R176 | functional | Profile shows activity: races per day and current streak. |
| R177 | functional | Profile shows rank history: average place and medals won. |
| R178 | functional | Profile shows improvement callouts (e.g. "Your 'ç' is 30% faster than last week"). |
| R179 | functional | Students choose a keyboard layout: Canadian French (CSA), French Canada, US QWERTY or AZERTY. |
| R180 | functional | Typing stats are stored per character and mapped onto the student's chosen layout for the heatmap. |
| R181 | functional | Heatmap colours run paper to gold to red (red = slow / error-prone). |
| R182 | functional | Clicking a heatmap key shows that key's trend over time. |
| R183 | functional | Clicking a heatmap key offers "Practise this letter", which creates a race with that letter as practice letter. |
| R184 | functional | (Lower priority) Medals/trophies such as first win, 50 WPM club, 100% accuracy race, accent master, 7-day streak are awarded and shown as enamel pins in the profile. |
| R185 | functional | (Lower priority) Players get ranks by average WPM: Recruit, Clerk, Officer, Commissar, Hero of Paperwork. |
| R186 | functional | (Lower priority) A "How to type it" page shows, for each special character (é è ê ë à â ç ù û ô î ï œ æ « » € ...), the key combination per keyboard layout and OS (Windows, macOS, ChromeOS). |
| R187 | functional | (Lower priority) The guide is linked from the heatmap and from special-character errors during a race ("Stuck on ç? Here's how"). |
| R188 | functional | The full UI is available in French and English. |
| R189 | functional | A UI language toggle in the header is remembered per user. |
| R190 | functional | Race language is independent from UI language (an English UI can host a French race). |
| R191 | non-technical | All UI copy and in-world labels are written in both French and English (e.g. "ОБГОН! · OVERTAKE / DÉPASSEMENT"). |
| R192 | constraint | Stack: React + Next.js (App Router) with TypeScript. |
| R193 | constraint | Styling uses Tailwind CSS with palette and fonts as CSS variables / theme tokens for light and dark. |
| R194 | constraint | Database is PostgreSQL, accessed through an ORM (repo has chosen Prisma per ADR 0002). |
| R195 | constraint | Authentication uses Auth.js (NextAuth) with Credentials, GitHub and Discord providers. |
| R196 | constraint | A separate Node real-time server (Socket.IO or Colyseus) is deployed next to the Next.js app to hold live race connections. |
| R197 | constraint | Redis stores room state, presence, reconnection tokens, host transfer state and single-use invite links. |
| R198 | non-functional | Races are server-authoritative: clients send keystrokes; the server validates them and computes progress and positions. |
| R199 | non-functional | The server broadcasts race state about 10 times per second. |
| R200 | non-functional | Pasting into the race input is blocked. |
| R201 | non-functional | The race text is rendered so it cannot be copied. |
| R202 | non-functional | The server applies a WPM cap, inhuman-regularity detection and keystroke-sequence validation to flag suspicious races. |
| R203 | functional | Races flagged as suspicious are excluded from stats and leaderboards. |
| R204 | functional | The data model covers at minimum users, OAuth accounts, lobbies, invites, races, race results, raw keystrokes, daily per-character stats, texts and achievements. |
| R205 | non-functional | Raw keystrokes are stored compressed with short retention (e.g. 30 days) and then purged. |
| R206 | non-functional | Raw keystrokes are rolled up into daily per-character stats (user, date, char, layout, hits, errors, avg ms) which the heatmap reads, so stats stay fast. |
| R207 | constraint | The site is served over HTTPS on the team's own site/domain (e.g. VPS or school server, reverse proxy, Let's Encrypt TLS). |
| R208 | non-technical | The GitHub repository uses a protected main branch, feature branches and pull requests. |
| R209 | non-technical | Releases use semantic version tags (e.g. v1.0.0) and a changelog. |
| R210 | non-functional | CI (GitHub Actions) runs lint, type-check, unit tests, automated E2E tests and build on every change. |
| R211 | non-functional | Merges to main are deployed automatically (CD). |
| R212 | non-functional | E2E test (Playwright, multiple contexts): a guest joins a quick race with bots, finishes and sees results. |
| R213 | non-functional | E2E test: host creates a private race, 2 students join by code, and a single-use link is refused on second use. |
| R214 | non-functional | E2E test: host leaves mid-lobby and host is transferred. |
| R215 | non-functional | E2E test: a student disconnects mid-race, the race continues, and they reconnect at the same position. |
| R216 | non-functional | E2E test: a player idle for 60 seconds is kicked. |
| R217 | non-functional | E2E test: in Block mode a wrong key does not advance the cursor. |
| R218 | non-functional | E2E tests: the timer ends a race, and "everyone finished" ends a race. |
| R219 | non-functional | E2E test: guest stats are merged after sign-up. |
| R220 | non-functional | E2E test: a phone viewport gets spectator-only mode. |
| R221 | non-functional | Load test: 60 simulated players (server bots) race in one room. |
| R222 | functional | Landing screen offers Quick race, Create private race, Join with code, plus language and theme toggles. |
| R223 | functional | Sign-in / sign-up screen offers Guest, username + password, GitHub and Discord. |
| R224 | functional | Lobby screen shows the player list with avatars, the host settings panel, the invite code/link and a Start button. |
| R225 | functional | A dedicated phone spectator screen exists. |
| R226 | functional | Settings screen lets the user set keyboard layout, theme and language, persisted per user. |
| R227 | non-technical | Screens are designed before build: landing, sign-in/up, lobby, race seat view, projector/spectator, phone spectator, Dawn report, Personnel file, special characters guide, settings. |

## Open questions

1. Spec section 0 (one-paragraph summary) is empty. Is anything missing from it?
2. Teacher Q1: is a one-time recovery code acceptable given 'no forgot password'? What exactly does redeeming it do (reset the password, log in once)?
3. Teacher Q2: should the teacher get a class dashboard showing all students' progress?
4. Teacher Q3: are short film quotes required, or is public-domain literature enough? Who obtains licences?
5. Teacher Q4: which domain and server will host the site (also needed for Redis and the separate real-time server)?
6. How does the teacher add teacher-written texts (an in-app editor, or a seed file)? Who moderates them?
7. Race card position: spec 6.2 says left gutter, PDF p.5 says top-left docket. Which is right? Also, does the 8-lane threshold use 'top 3 + 2 around you' (PDF) or '2 just ahead and behind' (spec)?
8. Public/Quick-race lobbies: who is host and who starts the race? Is there an auto-start countdown? How is a 'filled lobby' sized, and how many bots fill it?
9. Is a phone detected by viewport width, user agent or touch capability? How does a phone spectator join a specific race (code or link)?
10. Is the teacher/host a typing participant, a spectator on the projector view, or either?
11. Ranking ties and statuses: how do kicked 'Asleep at desk' players rank relative to abandoned 'Reassigned' and disconnected players?
12. How are WPM and accuracy computed for unfinished, kicked or disconnected players, and how are they computed in Block mode?
13. Exact grace period ('e.g. 2 minutes') and word-count/timer ranges ('e.g. 10-500', '1-10 min'): are these hard limits or examples?
14. Bonuses: how many words does Extra Paperwork add or Exemption remove? How long is Smoke Break, and how long are the cooldowns? Do bots receive or send bonuses, and do bots count when computing bottom 50/33/25%?
15. How is 'clean WPM' defined versus bonus-adjusted WPM when the text length changes?
16. Anti-cheat mentions leaderboards, but no leaderboard feature is specified. Is a global or class leaderboard in scope?
17. Avatar moderation 'basic filter': what does it check (file type/size only, or image content)? What is the size limit? Where are uploads stored?
18. Avatars are 'only visible to lobby members'. Are profiles (Personnel file) visible to anyone besides the owner?
19. Law 25: does collecting data from under-14 students require parental consent? Who handles deletion requests (self-serve button or teacher/admin)?
20. Guest ID persistence: if cookies are cleared the guest loses stats. Is that acceptable?
21. Exact definitions are needed for streak, personal-best 'length' buckets, rank thresholds (Hero of Paperwork WPM), and the full trophy list ('etc.').
22. How is the 'one thing to improve' (success criterion 3) chosen?
23. Real-time server: Socket.IO or Colyseus? It lives outside src/, so it needs a new ADR (ADR 0001 says a new top-level folder needs an ADR update; the product-spec says real-time transport needs an ADR).
24. Does the 'Accents: every word contains an accent' toggle apply to Real sentences texts, or only to generated word lists?
