/**
 * English catalog (ADR 0010). The shape of this object is the `Messages` type every catalog follows;
 * French (`fr.ts`), the locale cookie and `useT` arrive with #372.
 */
export const en = {
  brand: {
    name: "FIFTH COPY",
    wordmarkAlt: "Fifth Copy",
  },
  landing: {
    kicker: "MINISTRY OF TYPING · DESK 05 · 1978",
    tagline: "TYPE FAST · TYPE FIRST",
    pitch:
      "Thirty desks. One message. Everyone types the same copy, and the fastest clean copy gets the medal.",
    actions: {
      createPrivateRace: "CREATE PRIVATE RACE",
      creating: "CREATING…",
      joinFormName: "Join with code",
      joinWithCode: "JOIN WITH CODE",
      codePlaceholder: "KGB-4821",
      join: "JOIN →",
      joining: "JOINING…",
    },
    errors: {
      prefix: "RETURNED ·",
      invalidFormat: "Enter a code like KGB-4821",
      notFound: "No race with that code",
      closed: "That race has already started or closed",
      unavailable: "The ring rooms are not answering. Try again in a minute.",
      generic: "Something jammed. Try again.",
    },
  },
  lobby: {
    kicker: "WAITING ROOM · PRIVATE RACE",
    heading: "REPORT TO YOUR DESK",
    codeName: "Room code",
    codeTag: "ROOM CODE",
    typists: "TYPISTS",
    typistsValue: "{n} / {max}",
    status: "STATUS",
    waiting: "WAITING",
    listName: "Typists in the room",
    loading: "Calling the roll…",
    desk: "DESK {n}",
    host: "HOST",
    you: "YOU",
    players: { one: "{n} player in the room", other: "{n} players in the room" },
    reconnecting: "CONNECTION LOST, RETRYING",
  },
} as const;
