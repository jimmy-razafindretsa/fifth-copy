import { ACHIEVEMENT_IDS, type AchievementId, isAchievementId } from "../achievements/ids";

/**
 * The enamel pins of the Personnel file (#999 C36, spec 13.4, bible 13 "Chest pin", 7.6, 14.3
 * "Medals"): the whole catalogue of `ACHIEVEMENT_IDS` in its order, each pin earned, newly earned or
 * locked. Pure; the query reads the viewer's `Achievement` rows, the screen draws this.
 */

/** A pin awarded this many days ago or less reads `NEW` (no "seen" state is stored: time alone). */
export const MEDAL_NEW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type MedalState = "earned" | "new" | "locked";

export type Medal = {
  id: AchievementId;
  /** The pin's catalogue code, `PIN-01` .. (bible 7.6's item code). */
  code: string;
  state: MedalState;
  /** When it was pinned; null while locked. */
  awardedAt: Date | null;
};

export type MedalShelf = {
  medals: Medal[];
  /** How many pins the file holds (earned or new). */
  earned: number;
};

/** A stored award row (`Achievement`): ids outside the catalogue (a retired id) are ignored. */
export type MedalAward = { achievementId: string; awardedAt: Date };

export const pinCode = (index: number) => `PIN-${String(index + 1).padStart(2, "0")}`;

export function medalShelf(awards: readonly MedalAward[], now: Date): MedalShelf {
  const at = new Map<AchievementId, Date>();
  for (const a of awards) if (isAchievementId(a.achievementId)) at.set(a.achievementId, a.awardedAt);
  const medals = ACHIEVEMENT_IDS.map((id, i): Medal => {
    const awardedAt = at.get(id) ?? null;
    const state: MedalState =
      awardedAt === null
        ? "locked"
        : now.getTime() - awardedAt.getTime() <= MEDAL_NEW_DAYS * DAY_MS
          ? "new"
          : "earned";
    return { id, code: pinCode(i), state, awardedAt };
  });
  return { medals, earned: medals.filter((m) => m.state !== "locked").length };
}

/** The shelf of a file with no pin (every pin locked). */
export const emptyShelf = (): MedalShelf => medalShelf([], new Date(0));
