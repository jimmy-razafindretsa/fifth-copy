import type { Messages } from "@/i18n";

/** Strings the client leaves receive from the server page (ADR 0010: no `useT` until card 372). */
export type EntryLabels = Messages["landing"]["actions"];
export type EntryErrors = Messages["landing"]["errors"];

export type EntryError =
  "invalid-format" | "not-found" | "closed" | "race-server-unavailable" | "generic";

export function errorMessage(errors: EntryErrors, error: EntryError): string {
  switch (error) {
    case "invalid-format":
      return errors.invalidFormat;
    case "not-found":
      return errors.notFound;
    case "closed":
      return errors.closed;
    case "race-server-unavailable":
      return errors.unavailable;
    case "generic":
      return errors.generic;
  }
}
