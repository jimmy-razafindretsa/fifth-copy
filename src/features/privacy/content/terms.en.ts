import type { PrivacySection } from "./types";

/**
 * Conduct rules and terms of use, English (card #91). Shown on `/privacy#rules` (#80) and linked from sign-up.
 * The procedure behind each rule is `docs/privacy/moderation.md`. Keep in step with `terms.fr.ts` (same ids,
 * same number of paragraphs and list items; `terms.test.ts` checks parity and plain language).
 *
 * Written by the project, not by a lawyer. The sections `service` and `changes` (limits of responsibility) and
 * the whole text's effect for minors need a qualified review before launch: see "Needs qualified review" in
 * `docs/privacy/moderation.md`.
 */
export const termsEn: readonly PrivacySection[] = [
  {
    id: "about",
    heading: "What these rules are",
    paragraphs: [
      "Fifth Copy is a free typing race game for classrooms. It is a student project run by Jimmy Razafindretsa, a student at Cégep de Sorel-Tracy.",
      "These rules apply to everyone who plays, with or without an account. The teacher who hosts a race helps apply them in their room.",
      "Your school's own code of conduct still applies when you play in class. There is no chat in Fifth Copy, so your name, your picture and the way you race are what others see.",
    ],
  },
  {
    id: "usernames",
    heading: "Usernames",
    paragraphs: [
      "Pick a name you would be fine showing on the classroom projector. A filter checks names in French and English, but it does not catch everything.",
    ],
    list: [
      "No insults, slurs, hate, threats or sexual words, in any language or spelling.",
      "No references to drugs, alcohol or violence.",
      "Do not pretend to be a teacher, a classmate or someone else.",
      "Do not use your full real name or anyone else's.",
      "No personal details: no address, phone number, email, school ID or social media handle.",
    ],
  },
  {
    id: "avatars",
    heading: "Profile pictures",
    paragraphs: [
      "Your picture is only shown to the players in your lobby. It must be fine for a classroom.",
      "A filter checks every new picture. Some pictures are held for review, and everyone sees the default portrait until a person checks them.",
      "A refused picture is deleted and your previous picture stays. You will see why, and how to ask for another look.",
    ],
    list: [
      "No nudity, sexual content, violence, weapons, drugs or hate symbols.",
      "No photo of another person without their permission.",
      "No visible personal details, like a name, address or school ID.",
      "Better yet, do not use a photo of your face. A drawing or an object works fine.",
    ],
  },
  {
    id: "fair-play",
    heading: "Fair play",
    paragraphs: [
      "Type every key yourself. The server checks speed and rhythm, and a race that looks automated is marked as under review.",
      "A race under review does not count in stats or rankings. Being flagged is not proof of cheating, and you can ask for a review.",
    ],
    list: [
      "No scripts, bots, macros, auto-typers or tricks to paste text.",
      "Do not play on someone else's account or let others play on yours.",
      "Do not try to break, slow down or overload the game.",
      "If you find a bug, tell your teacher instead of using it.",
    ],
  },
  {
    id: "consequences",
    heading: "What happens if a rule is broken",
    paragraphs: [
      "The answer fits what happened. A first small mistake usually means a change, not a punishment.",
      "Serious problems, like threats or sexual content, are removed right away. Your teacher or school may be told so they can help.",
    ],
    list: [
      "The teacher can remove you from their lobby.",
      "A bad username is replaced by a random typist name.",
      "A bad picture is deleted.",
      "A cheated race stays out of stats and rankings.",
      "Repeated or serious problems can lead to your account being deleted.",
    ],
  },
  {
    id: "appeals",
    heading: "If you think a decision is wrong",
    paragraphs: [
      "Ask your teacher or your school office to contact the person in charge. Fifth Copy never asks for your email to do this.",
      "Say which username, which race or picture, and why you think the decision is wrong. You get an answer through the same person within 30 days.",
    ],
  },
  {
    id: "service",
    heading: "The game as it is",
    paragraphs: [
      "Fifth Copy is a free student project. It can have bugs, be unavailable at times, change or stop.",
      "Keep your recovery code safe. Without it, a lost password means a lost account, because there is no email to reset it.",
      "As far as the law allows, the project is not responsible for lost stats, lost accounts or a game that is down. Nothing here takes away rights the law gives you.",
    ],
  },
  {
    id: "changes",
    heading: "Changes to these rules",
    paragraphs: [
      "These rules can change. The date of the last change is shown on this page, and important changes are announced in the game.",
      "How your personal information is handled is explained in the other sections of this page.",
    ],
  },
];
