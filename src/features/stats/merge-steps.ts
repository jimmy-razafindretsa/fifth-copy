import { registerMergeStep } from "@/features/identity";
import { achievementMergeStep } from "./achievements/merge";
import { personalBestMergeStep } from "./personal-bests/merge";

// Guest merge (ADR 0009, #999 C35, C41): the guest's medals and personal bests move to the account.
registerMergeStep(achievementMergeStep);
registerMergeStep(personalBestMergeStep);
