import type { Job } from "./job";

/**
 * The worker's own no-op job (#733): its `JobRun` row every 5 minutes shows the runner is alive
 * before any feature job registers. The scheduler writes the row; the job itself does nothing.
 */
export const heartbeat: Job = {
  name: "heartbeat",
  every: { minutes: 5 },
  run: async () => undefined,
};
