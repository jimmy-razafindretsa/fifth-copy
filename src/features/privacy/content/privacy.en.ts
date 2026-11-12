import type { PrivacySection } from "./types";

/**
 * Privacy page, English (card #76). Second on `/privacy` after the French text (`privacy.fr.ts`), for players
 * aged 12 to 17: "you", short sentences. Same ids, paragraphs and list items as the French file
 * (`content.test.ts`). Every fact comes from `docs/privacy/*` and the ADRs (0009, 0014, 0019, 0022); what is
 * not delivered yet (#81 self-service deletion, #86 and #315 purges) is written in the future tense ("soon"),
 * never as a present fact (owner decision, 2026-11-02). Accounts (#36), the session cookie (#38) and GitHub,
 * Discord and Google sign-in (#49, #828) are delivered, so they read in the present tense.
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
      "If you create an account: your username and a scrambled form of your password and recovery code. We never keep the password itself.",
      "If you sign in with GitHub, Discord or Google: your account number with that service.",
      "If a teacher gives you a code to reset your password: a scrambled form of the code, and which teacher gave it.",
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
      "Your account lets you sign in and find your results on any computer.",
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
      "Account (username, GitHub, Discord or Google): kept until you delete it, or your school asks us to.",
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
      "A profile picture is optional. If you add one, only you and the players who share a lobby or a race with you see it. After a race, they can still see it for 24 hours.",
      "Their browser may keep the copy it was shown, even after that.",
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
      "Session cookie: it keeps you signed in to your account until you sign out, 30 days at most.",
      "Sign-in cookies: a few short-lived cookies protect the sign-in itself. They last a few minutes, or until you close your browser.",
    ],
  },
  {
    id: "third-parties",
    heading: "Other services we use",
    paragraphs: [
      "Fifth Copy runs on the servers of Railway, a hosting company. Your data is kept in the United States, in the San Francisco region, so outside Québec.",
      "You can sign in with GitHub, Discord or Google. They only get what your own sign-in sends them. We only read your account number, your name and your picture, never your email.",
      "These services are for people 13 or older. If you are younger, use a username or play as a guest.",
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
