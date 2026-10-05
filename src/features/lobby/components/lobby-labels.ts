import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";

/** The waiting room's strings, passed from the server page (ADR 0010: no `useT` until card 372). */
export type LobbyLabels = Messages["lobby"];

export { fill };

/** `DESK 05`: desks read as paperwork numbers (bible 2). */
export const deskLabel = (labels: LobbyLabels, desk: number) =>
  fill(labels.desk, { n: String(desk).padStart(2, "0") });

export const playersLabel = (labels: LobbyLabels, n: number) =>
  fill(n === 1 ? labels.players.one : labels.players.other, { n });
