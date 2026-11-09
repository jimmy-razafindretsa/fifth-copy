import type { ResetField } from "../schema";

/**
 * What `redeemRecoveryCode` answers (#46 C3, C4): `status` for callers and tests, the messages in the
 * viewer's locale (`auth.recovery.errors.*`). `done` carries the new code, revealed once by the
 * success state (nowhere else: never logged, never stored in plaintext). Never echoes the input.
 */
export type RecoverFormState = {
  status: "idle" | "done" | "fields" | "invalid" | "rate-limited" | "error";
  fieldErrors: Partial<Record<ResetField, string>>;
  formError: string | null;
  retryAfterMs?: number;
  /** Only with `done`: the rotated code, in display order. */
  words?: string[];
};

export const INITIAL_RECOVER_STATE: RecoverFormState = {
  status: "idle",
  fieldErrors: {},
  formError: null,
};
