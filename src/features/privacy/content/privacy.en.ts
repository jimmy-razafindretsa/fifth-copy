import type { PrivacySection } from "./types";

/**
 * Privacy page, English (card #76). Second on `/privacy` after the French text (`privacy.fr.ts`), for players
 * aged 12 to 17: "you", short sentences. Same ids, paragraphs and list items as the French file
 * (`content.test.ts`). Every fact comes from `docs/privacy/*` and the ADRs (0009, 0014, 0019); what is not
 * delivered yet is written in the future tense ("soon"), never as a present fact (owner decision, 2026-11-02).
 * Not reviewed by a lawyer (#438).
 */
export const privacyEn: readonly PrivacySection[] = [
  {
    id: "collect",
    heading: "What we collect",
    paragraphs: [
      "Fifth Copy never asks for your email, your real name, your birth date or your school.",
      "Most students play as guests. Here is what the game keeps about you.",
    ],
    list: [
      "A guest number, kept in a cookie in your browser.",
      "Your typist name. Guests get one at random, like Sparrow-482.",
      "Your race results: speed, accuracy, rank and time.",
      "The keys you type during a race, with their timing.",
      "The look of your 3D clerk and your settings, like language and theme.",
      "Your device's address on the Internet (IP), when it talks to our servers.",
      "Your profile picture, only if you add one.",
      "Soon, if you create an account: your username and a scrambled form of your password, never the password itself.",
    ],
  },
  {
    id: "why",
    heading: "Why we collect it",
    paragraphs: [
      "We keep only what the game needs to work.",
      "We sell nothing. We show no ads. We send nothing to a service that measures visits.",
    ],
    list: [
      "Your guest number links your results and settings to you, without a password.",
      "Your typist name helps players tell each other apart in a lobby.",
      "Your results feed your history, your stats and the rankings.",
      "Your keys feed the per-key stats and help us spot cheating.",
      "Your IP address helps us find errors and abuse.",
      "Your clerk and your settings only show what you chose.",
    ],
  },
  {
    id: "retention",
    heading: "How long we keep it",
    paragraphs: [
      "We keep nothing longer than needed. Here is how long we keep each thing.",
      "The automatic deletion of guests and keys is coming soon.",
    ],
    list: [
      "Inactive guest account: it will be deleted after 12 months with no race, sign-in or settings change.",
      "Account with a username, soon: kept until you delete it, or your school asks us to.",
      "Keys typed during a race: they will be deleted 30 days after the race.",
      "Server logs and IP addresses: 30 days.",
      "Lobbies: 24 hours after they close.",
      "Live race rooms: 1 hour after the last activity.",
      "Backup copies: 14 days, then they are replaced.",
      "Cookies in your browser: 1 year at most.",
    ],
  },
  {
    id: "avatars",
    heading: "Who sees your picture",
    paragraphs: [
      "A profile picture is optional. If you add one, only the players in your lobby see it.",
      "A filter checks every new picture on our server. Your picture is never sent anywhere else to be checked.",
      "The person in charge looks at your picture only if it is held for review or reported. They look to decide, and never copy it.",
      "A refused picture is deleted right away.",
    ],
  },
  {
    id: "delete",
    heading: "Delete my data",
    paragraphs: [
      "You can ask us to delete all your data. Ask your teacher or your school office. They pass your request to the person in charge.",
      "You do not have to give an email or any other information. You get an answer within 30 days.",
      "Soon, you will also be able to delete your data yourself in your settings.",
      "After the deletion, a copy stays in the backups for 14 days at most. Then it is gone.",
    ],
  },
  {
    id: "responsible",
    heading: "Who is responsible",
    paragraphs: [
      "The person in charge of your personal information is Jimmy Razafindretsa. He is a student at Cégep de Sorel-Tracy, and he builds and runs Fifth Copy.",
      "Do you have a question or a complaint? Ask your teacher or your school office. They pass it on to the person in charge.",
      "Every request gets an answer within 30 days.",
    ],
  },
  {
    id: "cookies",
    heading: "Cookies",
    paragraphs: [
      "A cookie is a small file your browser keeps for our site. Fifth Copy uses only its own cookies, never advertising cookies.",
      "No script on the page can read these cookies.",
    ],
    list: [
      "fc_guest: your signed guest number, to recognise you without a password. It lasts 1 year at most.",
      "locale: the language you pick. It lasts 1 year.",
      "theme: the light theme or night shift. It lasts 1 year.",
      "Session cookie: soon, it will keep you signed in to your account until you sign out.",
    ],
  },
  {
    id: "third-parties",
    heading: "Other services we use",
    paragraphs: [
      "Fifth Copy runs on the servers of Railway, a hosting company. Your data is kept in the United States, in the San Francisco region, so outside Québec.",
      "Soon, you will be able to sign in with GitHub or Discord. They will only get what your own sign-in sends them. We will only read your account number, your name and your picture.",
      "We share nothing with other companies for advertising.",
    ],
  },
  {
    id: "rules",
    heading: "Rules (terms of use)",
    paragraphs: [
      "These rules say how to play well with others. They apply to you, with or without an account.",
    ],
  },
];
