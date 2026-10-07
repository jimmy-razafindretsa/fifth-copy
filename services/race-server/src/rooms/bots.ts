import type { BotLevel } from "@fifth-copy/protocol";
import { nextDesk } from "./desks";

/**
 * Bot seats (#156, ADR 0006 point 3, ARCHITECTURE 7.5): pure helpers the registry uses to seat bot
 * members in a room's members hash. Bots do not type here (#361 profile, #366 scheduler).
 */

/**
 * Placeholder in-world clerk names, cycled by desk. #361 replaces this list by name with the final
 * bilingual one (checked against `isClean`).
 */
export const BOT_NAMES: readonly string[] = [
  "Clerk Dubois",
  "Agent 47",
  "Clerk Moreau",
  "Inspector Petrov",
  "Clerk Tremblay",
  "Officer Kovac",
  "Clerk Gagnon",
  "Archivist Lebrun",
  "Clerk Novak",
  "Auditor Roy",
  "Clerk Volkova",
  "Agent 12",
];

const BOT_PREFIX = "bot:";

/** The members-hash key of a bot desk. Never a web user id (those are cuids), never on the wire. */
export const botUserId = (desk: number) => `${BOT_PREFIX}${desk}`;
export const isBotUserId = (userId: string) => userId.startsWith(BOT_PREFIX);

/**
 * Desk 1 is never a bot's: the room is opened before its host joins, and the host takes desk 1
 * (contract C1, "human joined first at 1").
 */
const HOST_DESK = 1;

const ROMAN: [number, string][] = [
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];
function roman(n: number): string {
  let out = "";
  for (const [value, digits] of ROMAN) {
    while (n >= value) {
      out += digits;
      n -= value;
    }
  }
  return out;
}

/**
 * The bot name of a desk: `BOT_NAMES` cycled by desk, suffixed ` II`, ` III`... from the second
 * cycle on, so two desks of one room never share a bot name.
 */
export function botName(desk: number): string {
  const index = (desk - 1) % BOT_NAMES.length;
  const cycle = Math.floor((desk - 1) / BOT_NAMES.length);
  const base = BOT_NAMES[index]!;
  return cycle === 0 ? base : `${base} ${roman(cycle + 1)}`;
}

export type BotSeat = { desk: number; level: BotLevel };

/**
 * The bot seats a room must hold for `levels` (one per bot, in order), given every desk taken now:
 * existing bot desks are kept lowest first, new bots take the lowest free desks (never desk 1),
 * extra bots are removed highest desk first. Levels go to the kept and added desks in ascending desk
 * order. `bots` are the room's bot desks; `taken` every desk, humans included.
 */
export function planBotSeats(
  bots: readonly number[],
  taken: readonly number[],
  levels: readonly BotLevel[],
): { seats: BotSeat[]; remove: number[] } {
  const current = [...bots].sort((a, b) => a - b);
  const kept = current.slice(0, levels.length);
  const remove = current.slice(levels.length).reverse();
  const used = [HOST_DESK, ...taken];
  const desks = [...kept];
  while (desks.length < levels.length) {
    const desk = nextDesk(used);
    used.push(desk);
    desks.push(desk);
  }
  desks.sort((a, b) => a - b);
  return { seats: desks.map((desk, i) => ({ desk, level: levels[i]! })), remove };
}
