/**
 * The locker items a pin will unlock (#999 C36; bible 10.1, 7.6, 14.2): catalogue item -> the stable
 * achievement id (`ACHIEVEMENT_IDS` of the stats feature, #999 C34) whose pin opens it. Data only: the
 * v1 locker still renders no locked card (bible 14.2 "v1 scope"); the locker's locks read this list
 * when they ship. The ids are plain strings here (identity never imports stats); a stats test pins
 * every value to `ACHIEVEMENT_IDS` and every key to the catalogue.
 */
export const PIN_LOCKS: Readonly<Record<string, string>> = {
  "hat:eyeshade": "first-win",
  "clothes:braces": "wpm-50-club",
  "glasses:monocle": "accuracy-100",
  "hat:beret": "accent-master",
  "hat:ushanka": "streak-7-days",
};
