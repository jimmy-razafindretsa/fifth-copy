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
  },
} as const;
