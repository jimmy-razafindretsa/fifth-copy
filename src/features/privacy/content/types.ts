/**
 * Structured privacy-page content (card #91). One section = one anchor on `/privacy` (rendering: #80).
 * Reused by the Law 25 page content (#77). Plain strings only: no markup, no catalog keys (long-form text,
 * not UI labels, so it stays out of the src/i18n catalogs).
 */
export type PrivacySection = {
  /** Stable kebab-case anchor, identical in every language (`/privacy#fair-play`). */
  readonly id: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly list?: readonly string[];
};

/** Date of the last change to the conduct rules (terms.fr.ts / terms.en.ts). Change it with the text. */
export const TERMS_UPDATED = "2026-10-06";
