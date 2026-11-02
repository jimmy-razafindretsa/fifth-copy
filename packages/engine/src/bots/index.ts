// bots: the bot typing model's interface (ADR 0007, ARCHITECTURE 7.5); re-exported by src/index.ts
export { nextBotKeystroke } from "./next";
export { BOT_LEVEL_WPM, botProfile } from "./profile";
export {
  BOT_LEVELS,
  type BotAction,
  type BotContext,
  type BotLevel,
  type BotProfile,
} from "./types";
