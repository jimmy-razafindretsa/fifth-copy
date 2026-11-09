import type { ResetField } from "../schema";

/**
 * What `redeemPasswordReset` answers (#789): `status` for callers and tests, the messages in the
 * viewer's locale (`auth.reset.errors.*`) per field and for the form. Never echoes the input.
 * `idle` before any attempt; `done` once the code is consumed and the password set.
 */
export type ResetFormState = {
  status: "idle" | "done" | "fields" | "invalid" | "rate-limited" | "error";
  fieldErrors: Partial<Record<ResetField, string>>;
  formError: string | null;
  /** Only with `rate-limited`: how long until the next attempt is counted again. */
  retryAfterMs?: number;
};

export const INITIAL_RESET_STATE: ResetFormState = {
  status: "idle",
  fieldErrors: {},
  formError: null,
};
