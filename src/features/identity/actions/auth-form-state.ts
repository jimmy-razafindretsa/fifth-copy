import type { AuthField } from "../schema";

/**
 * What the sign-up and sign-in actions answer when they do not redirect (#36): translated messages
 * (the viewer's locale, `auth.errors.*`) per field, and one form-level message. Never echoes input.
 */
export type AuthFormState = {
  fieldErrors: Partial<Record<AuthField, string>>;
  formError: string | null;
};

export const INITIAL_AUTH_STATE: AuthFormState = { fieldErrors: {}, formError: null };
