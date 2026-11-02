import { BOT_NAMES } from "@fifth-copy/engine";
import type { BotLevel, RaceLanguage } from "@fifth-copy/protocol";
import { nextDesk } from "./desks";

/**
 * Bot seats (#156, ADR 0006 point 3, ARCHITECTURE 7.5): pure helpers the registry uses to seat bot
 * members in a room's members hash. Bots do not type here (#366 scheduler over the engine's
 * `nextBotKeystroke`, #361). Names come from the engine's bilingual `BOT_NAMES` (#361).
 */

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
 * The bot name of a desk in the race language: `BOT_NAMES[language]` cycled by desk, suffixed
 * ` II`, ` III`... from the second cycle on, so two desks of one room never share a bot name.
 */
export function botName(desk: number, language: RaceLanguage): string {
  const names = BOT_NAMES[language];
  const index = (desk - 1) % names.length;
  const cycle = Math.floor((desk - 1) / names.length);
  const base = names[index]!;
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
