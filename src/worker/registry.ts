import { voidStaleRaces } from "@/features/results/jobs/void-stale-races";
import { heartbeat } from "./heartbeat";
import type { Job } from "./job";

/**
 * Every job the worker runs (ADR 0011). To add one: export a `Job` from the owning feature's
 * `jobs/` folder (src/features/<feature>/jobs/<name>.ts) and list it here; nothing else changes.
 */
export const jobs: readonly Job[] = [heartbeat, voidStaleRaces];
