import type { Locale } from "@/i18n";
import { privacyEn } from "./privacy.en";
import { privacyFr } from "./privacy.fr";
import { termsEn } from "./terms.en";
import { termsFr } from "./terms.fr";
import type { PrivacySection } from "./types";

const PRIVACY: Record<Locale, readonly PrivacySection[]> = { fr: privacyFr, en: privacyEn };
const TERMS: Record<Locale, readonly PrivacySection[]> = { fr: termsFr, en: termsEn };

/** The privacy page text of a language (#76). A new language = one content file + one entry here. */
export const privacyContentFor = (locale: Locale) => PRIVACY[locale];

/** The conduct rules (#91) of a language, shown under the page's `rules` section. */
export const termsContentFor = (locale: Locale) => TERMS[locale];
