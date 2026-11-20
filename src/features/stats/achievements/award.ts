import "server-only";
import type { AfterSaveStep } from "@/features/results/server";
import { dayKey } from "@/lib/time";
import { isCountedResult } from "../counted";
import { countedWhere } from "../queries/counted-where";
import { raceSettingsFacts } from "../race-facts";
import { ACHIEVEMENT_IDS, type AchievementId } from "./ids";
import { dayStreak, earnedBy, STREAK_DAYS } from "./rules";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The achievement step of the results filing transaction (#999 C35, ADR 0011's "inside the results
 * transaction" option): for each counted, unflagged human result of the chunk, `earnedBy` its facts,
 * then one `createMany` that skips duplicates, so the `(userId, achievementId)` key awards each medal
 * at most once and a repeated chunk changes nothing. The 7-day streak reads the typist's counted
 * results of the last `STREAK_DAYS` + 1 days (one narrow query, only for typists who do not hold it
 * yet). `now` is injected for tests.
 */
export function awardAchievementsStep({ now = () => new Date() }: { now?: () => Date } = {}) {
  const step: AfterSaveStep = async (tx, { race, results }) => {
    const counted = results.filter(isCountedResult);
    if (counted.length === 0) return;
    const settings = raceSettingsFacts(race.settings);
    const accentText =
      settings !== null && (settings.accentEveryWord || settings.textType === "special-characters");
    const userIds = [...new Set(counted.map((r) => r.userId))];
    const held = new Set(
      (
        await tx.achievement.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, achievementId: true },
        })
      ).map((a) => `${a.userId}:${a.achievementId}`),
    );
    const at = now();
    const today = dayKey(at);
    const since = new Date(at.getTime() - (STREAK_DAYS + 1) * DAY_MS);
    const awards: { userId: string; achievementId: AchievementId; awardedAt: Date }[] = [];
    for (const r of counted) {
      const left = ACHIEVEMENT_IDS.filter((id) => !held.has(`${r.userId}:${id}`));
      if (left.length === 0) continue;
      let streakDays: number | null = null;
      if (left.includes("streak-7-days")) {
        const rows = await tx.raceResult.findMany({
          where: { ...countedWhere(r.userId), createdAt: { gte: since } },
          select: { createdAt: true },
        });
        // this result is counted and filed now: today is always in the run
        streakDays = dayStreak([today, ...rows.map((row) => dayKey(row.createdAt))], today);
      }
      for (const id of earnedBy({
        result: r,
        race: { lobbySize: race.lobbySize, accentText },
        streakDays,
      })) {
        if (!left.includes(id)) continue;
        held.add(`${r.userId}:${id}`);
        awards.push({ userId: r.userId, achievementId: id, awardedAt: at });
      }
    }
    if (awards.length > 0) await tx.achievement.createMany({ data: awards, skipDuplicates: true });
  };
  return step;
}

/** The step the filing route composes. */
export const awardAchievements: AfterSaveStep = awardAchievementsStep();
