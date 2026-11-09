// Public identity API (ARCHITECTURE 8.2). Server-only at runtime: client
// components may only `import type { Viewer }` from here.
export { getViewer, requireViewer, UnauthenticatedError, type Viewer } from "@/server/auth";
export { ensureGuest } from "./actions/ensure-guest";
export { uploadAvatar, type UploadAvatarResult } from "./actions/upload-avatar";
export { importOauthAvatar, type ImportOauthAvatarResult } from "./avatars/import-oauth-avatar";
export { readAvatarFile } from "./queries/avatar-file";
export { avatarStore } from "./avatars/default-store";
export type { AvatarStore, AvatarSize } from "./avatars/store";
export type { AvatarErrorCode } from "./avatars/errors";
export { avatarNotice } from "./avatars/moderation/notice";
export { avatarQuery, normalizeUsername } from "./schema";
// The keyboard layouts (R179, #224): pure data the race machine, the settings picker (#66) and the heatmap read.
export { keyboardLayoutIds, layouts, type KeyboardLayoutId } from "./keyboard/layouts";
// The clerk outfit (bible 10.1, #687): catalogue, validation, the per-desk fallback, the save and the read.
export {
  OUTFIT_CATALOGUE,
  OUTFIT_CATEGORIES,
  outfitForDesk,
  parseOutfit,
  type Outfit,
  type OutfitCategory,
} from "./clerk/outfit";
export { outfitSchema } from "./schema";
export {
  saveClerkOutfit,
  type SaveClerkOutfit,
  type SaveClerkOutfitResult,
} from "./actions/save-clerk-outfit";
export { getClerkOutfit } from "./queries/clerk-outfit";
// The guest merge (ADR 0009, #56): one transaction, then the guest row is deleted. Features that
// store per-user rows register a step; merge/coverage.test.ts fails when one is missing.
export { mergeGuestInto, type MergeCounts } from "./merge/merge-guest";
export {
  registerMergeStep,
  type MergeContext,
  type MergeStep,
  type MergeTx,
} from "./merge/registry";
export { MergeGuestError } from "./merge/steps";
// The teacher password reset (#788): the host issues a single-use code; the redeem (R2) and the host
// control (R3) share the code helpers.
export { issuePasswordReset, type IssuePasswordResetResult } from "./actions/issue-password-reset";
export { formatResetCode, normalizeResetCode, RESET_CODE_TTL_MS } from "./password-reset/code";
// The host control (#790): whether the viewer may issue codes in a lobby (the docket's render gate).
export { canIssueResetIn } from "./queries/reset-eligibility";
// The merge stamp (#57): merge callers leave the flash with `flashMerge(counts)`; the root layout mounts
// `MergeStamp`, which shows it once.
export { flashMerge } from "./merge/flash";
export { MergeStamp } from "./components/merge-stamp";
// Sign-up, sign-in and sign-out (#36): the actions, the two screens and the header account control.
export { signUp, signUpAction } from "./actions/sign-up";
export { signIn, signInAction } from "./actions/sign-in";
export { signOut } from "./actions/sign-out";
export type { AuthFormState } from "./actions/auth-form-state";
export { AuthScreen, AUTH_LINKS, type AuthMode } from "./components/auth-screen";
export {
  AccountControl,
  type AccountClasses,
  type AccountLabels,
} from "./components/account-control";
export { safeCallbackUrl } from "./auth/callback-url";
export { AuthStates } from "./components/auth-states";
// The teacher reset, redeemed (#789): the action and the `/reset` screen and its `/design` states.
export { redeemPasswordReset, redeemPasswordResetAction } from "./actions/redeem-password-reset";
export type { ResetFormState } from "./actions/reset-form-state";
export { ResetScreen } from "./components/reset-screen";
export { ResetStates } from "./components/reset-states";
// The one-time recovery code (#46, ADR 0009): issued at sign-up, revealed once, redeemed on `/recover`.
export { issueRecoveryCode } from "./actions/issue-recovery-code";
export { redeemRecoveryCode, redeemRecoveryCodeAction } from "./actions/redeem-recovery-code";
export { takeReveal as takeRecoveryReveal } from "./recovery/reveal";
export { RecoverScreen } from "./components/recover-screen";
export { RecoveryRevealScreen } from "./components/recovery-reveal-screen";
export { RecoverStates } from "./components/recover-states";
