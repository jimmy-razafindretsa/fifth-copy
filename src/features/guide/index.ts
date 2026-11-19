/**
 * The special-characters guide (#999 C26-C29, spec 14, bible 14.3 "How to type special characters"): its
 * own feature (ADR 0001), static content. Client components take the deep links from `client.ts`.
 */
export { GUIDE_CHARS, GUIDE_PATH, guideAnchor, guideHref } from "./chars";
export {
  GUIDE_CONTENT,
  GUIDE_LAYOUTS,
  GUIDE_OSES,
  shownCombination,
  type GuideOs,
} from "./content";
export { detectOs } from "./os";
export { GuideScreen } from "./components/guide-screen";
export { GuideView, type GuideDesk } from "./components/guide-view";
export { getGuideDesk } from "./queries/get-guide-desk";
