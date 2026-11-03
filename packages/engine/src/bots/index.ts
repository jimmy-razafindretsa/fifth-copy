// bots: the bot typing model (ADR 0007, ARCHITECTURE 7.5); re-exported by src/index.ts
export { nextBotKeystroke } from "./next";
export { BOT_NAMES } from "./names";
export { BOT_LEVEL_WPM, botProfile } from "./profile";
export { RARE_LETTERS } from "./pace";
export {
  BOT_LEVELS,
  type BotAction,
  type BotContext,
  type BotLanguage,
  type BotLevel,
  type BotProfile,
} from "./types";
