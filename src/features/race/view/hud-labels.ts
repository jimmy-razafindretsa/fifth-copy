/**
 * The seat view HUD's copy (#560, design bible 2, 7.4a, 7.11): one label type per HUD component, passed
 * as props (ADR 0010: the race page reads them from the `race` catalogs, added with the wiring cards #561,
 * #233, #235, #236). `{name}` placeholders are filled with `fill` from `@/i18n/format`.
 * `hudLabelFixtures` holds the English and French specimen copy of `/design#race-hud` and the tests; the
 * catalogs take these strings over (bible 2 lists them).
 */
import type { LaneStatus } from "./race-card-view";

export type NixieLabels = {
  /** Tags under the tubes: `WPM` / `MPM`, `PLACE` / `RANG`. */
  wpm: string;
  place: string;
  /** The counters in words: `{wpm}`, `{place}`, `{total}`. */
  aria: string;
  /** Before a place exists (before the start): `{wpm}`, `{total}`. */
  ariaNoPlace: string;
  /** The timer tube's tag (#240): `TIME` / `TEMPS`. */
  time: string;
  /** Appended to the words while a timer runs (#240): `, {time} left` (`{time}` = mm:ss). */
  ariaTime: string;
};

export type RaceCardLabels = {
  /** The docket's tag and accessible name: `RACE CARD`. */
  title: string;
  /** The header's mono value: `{n} TYPISTS`. */
  typists: string;
  /** The full-field line in words: `{n}` players, your progress `{you}` in percent. */
  field: string;
  /** The lanes list's accessible name. */
  lanes: string;
  /** Paperwork desk number: `DESK {n}` (`n` zero-padded). */
  desk: string;
  /** The ink tag on your lane. */
  you: string;
  /** One lane in words: `{rank}`, `{name}`, `{you}` (`, YOU` on your lane), `{desk}`, `{progress}`
   * (percent), then `{status}`. */
  lane: string;
  status: Record<Exclude<LaneStatus, "typing">, string>;
};

/** The three catch-up cards (spec 10; engine `BonusKind`, mirrored here: the HUD never imports the engine). */
export const SABOTAGE_CARDS = ["extra-paperwork", "exemption", "smoke-break"] as const;
export type SabotageCard = (typeof SABOTAGE_CARDS)[number];

export type SabotageTrayLabels = {
  /** The docket's tag and accessible name: `SABOTAGE TRAY`. */
  title: string;
  /** The empty slot (bible 7.6 empty state): a title and one line. */
  empty: { title: string; body: string };
  cards: Record<SabotageCard, { name: string; effect: string }>;
  /** Row labels: the play hint and the cooldown, then the seconds value `{n} S`. */
  play: string;
  cooldown: string;
  seconds: string;
  /** How to play a ready card (#236): `ENTER TO PLAY`, the `PLAY` row's value. */
  hint: string;
  /** The pointer path's ink button (#236): `PLAY CARD`. */
  playButton: string;
  /** The refused play's row (#236; the server's `no-bonus` while a card is held): `IMMUNE`. */
  immune: string;
};

export type AbandonLabels = {
  /** The secondary button (bible 7.1). */
  abandon: string;
  /** The ink confirm button. */
  confirm: string;
};

/** How your desk left the race (#233): the store's `ExitKind`, mirrored (the HUD never imports the client). */
export const EXIT_KINDS = ["abandoned", "asleep"] as const;
export type ExitDocketKind = (typeof EXIT_KINDS)[number];

/** The exit dockets (#233, bible 7.3, 7.4): Reassigned after ABANDON, Asleep at desk after the idle kick. */
export type ExitLabels = {
  /** The ink stamp, also the docket's name: `REASSIGNED`, `ASLEEP AT DESK`. */
  stamp: Record<ExitDocketKind, string>;
  /** Row labels of your partial stats. */
  wpm: string;
  accuracy: string;
  place: string;
  /** Reassigned ranks last (ADR 0007): the `PLACE` row's value. */
  last: string;
  /** The accuracy value: `{n} %` (U+00A0 before the sign). */
  percent: string;
  /** The secondary button: the docket closes, the HUD stays live without input. */
  keepWatching: string;
  /** The ink link to `/lobby/[code]` after Reassigned (the seat view's lost-line string). */
  back: string;
  /** The ink link to `/lobby/[code]` after the idle kick. */
  leave: string;
};

export const RACE_NOTICES = [
  "waiting-for-host",
  "reconnecting",
  "idle-warning",
  "no-scene",
] as const;
export type RaceNoticeKind = (typeof RACE_NOTICES)[number];
export type RaceNoticeLabels = Record<RaceNoticeKind, string>;

export type HudLabels = {
  nixie: NixieLabels;
  raceCard: RaceCardLabels;
  sabotageTray: SabotageTrayLabels;
  abandon: AbandonLabels;
  notice: RaceNoticeLabels;
  exit: ExitLabels;
};

export const hudLabelFixtures = {
  en: {
    nixie: {
      wpm: "WPM",
      place: "PLACE",
      aria: "Words per minute {wpm}, place {place} of {total}",
      ariaNoPlace: "Words per minute {wpm}, {total} typists, no place yet",
      time: "TIME",
      ariaTime: ", {time} left",
    },
    raceCard: {
      title: "RACE CARD",
      typists: "{n} TYPISTS",
      field: "{n} typists on the line, you at {you}%",
      lanes: "Lanes",
      desk: "DESK {n}",
      you: "YOU",
      lane: "Place {rank}, {name}{you}, desk {desk}, {progress}% typed{status}",
      status: {
        "line-cut": "LINE CUT",
        expired: "EXPIRED",
        asleep: "ASLEEP AT DESK",
        abandoned: "REASSIGNED",
        finished: "FILED",
      },
    },
    sabotageTray: {
      title: "SABOTAGE TRAY",
      empty: { title: "NO CARD", body: "Cards go to the typists behind the leader." },
      cards: {
        "extra-paperwork": {
          name: "EXTRA PAPERWORK",
          effect: "Adds words to the leader's text.",
        },
        exemption: { name: "EXEMPTION", effect: "Removes words from your remaining text." },
        "smoke-break": {
          name: "SMOKE BREAK",
          effect: "Blurs the text of the typists ahead of you for a few seconds.",
        },
      },
      play: "PLAY",
      cooldown: "COOLDOWN",
      seconds: "{n} S",
      hint: "ENTER TO PLAY",
      playButton: "PLAY CARD",
      immune: "IMMUNE",
    },
    abandon: { abandon: "ABANDON", confirm: "CONFIRM · REASSIGN ME" },
    notice: {
      "waiting-for-host": "WAITING FOR THE HOST",
      reconnecting: "LINE CUT · RECONNECTING",
      "idle-warning": "THE MAJOR IS LOOKING AT YOU. TYPE.",
      "no-scene": "NO PICTURE FROM THE ROOM · KEEP TYPING",
    },
    exit: {
      stamp: { abandoned: "REASSIGNED", asleep: "ASLEEP AT DESK" },
      wpm: "WPM",
      accuracy: "ACCURACY",
      place: "PLACE",
      last: "LAST",
      percent: "{n}\u00a0%",
      keepWatching: "KEEP WATCHING",
      back: "BACK TO THE WAITING ROOM →",
      leave: "LEAVE →",
    },
  },
  fr: {
    nixie: {
      wpm: "MPM",
      place: "RANG",
      aria: "Mots par minute {wpm}, rang {place} sur {total}",
      ariaNoPlace: "Mots par minute {wpm}, {total} dactylos, pas encore de rang",
      time: "TEMPS",
      ariaTime: ", {time} restant",
    },
    raceCard: {
      title: "FICHE DE COURSE",
      typists: "{n} DACTYLOS",
      field: "{n} dactylos sur la ligne, toi à {you} %",
      lanes: "Couloirs",
      desk: "BUREAU {n}",
      you: "TOI",
      lane: "Rang {rank}, {name}{you}, bureau {desk}, {progress} % tapé{status}",
      status: {
        "line-cut": "LIGNE COUPÉE",
        expired: "EXPIRÉ",
        asleep: "ENDORMI AU BUREAU",
        abandoned: "RÉAFFECTÉ",
        finished: "CLASSÉ",
      },
    },
    sabotageTray: {
      title: "PLATEAU DE SABOTAGE",
      empty: { title: "AUCUNE CARTE", body: "Les cartes vont aux dactylos derrière le premier." },
      cards: {
        "extra-paperwork": {
          name: "PAPERASSE SUPPLÉMENTAIRE",
          effect: "Ajoute des mots au texte du premier.",
        },
        exemption: { name: "EXEMPTION", effect: "Retire des mots de ton texte restant." },
        "smoke-break": {
          name: "PAUSE CIGARETTE",
          effect: "Brouille le texte des dactylos devant toi pendant quelques secondes.",
        },
      },
      play: "JOUER",
      cooldown: "RECHARGE",
      seconds: "{n} S",
      hint: "ENTRÉE POUR JOUER",
      playButton: "JOUER LA CARTE",
      immune: "IMMUNISÉ",
    },
    abandon: { abandon: "ABANDONNER", confirm: "CONFIRMER · ME RÉAFFECTER" },
    notice: {
      "waiting-for-host": "EN ATTENTE DE L'HÔTE",
      reconnecting: "LIGNE COUPÉE · RECONNEXION",
      "idle-warning": "LE MAJOR TE REGARDE. TAPE.",
      "no-scene": "PAS D'IMAGE DE LA SALLE · CONTINUE DE TAPER",
    },
    exit: {
      stamp: { abandoned: "RÉAFFECTÉ", asleep: "ENDORMI AU BUREAU" },
      wpm: "MPM",
      accuracy: "PRÉCISION",
      place: "RANG",
      last: "DERNIER",
      percent: "{n}\u00a0%",
      keepWatching: "CONTINUER À REGARDER",
      back: "RETOUR À LA SALLE D'ATTENTE →",
      leave: "QUITTER →",
    },
  },
} satisfies Record<"en" | "fr", HudLabels>;
