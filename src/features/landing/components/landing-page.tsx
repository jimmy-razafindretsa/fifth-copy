import { getViewer } from "@/features/identity";
import { fill, getT } from "@/i18n";
import { LINKS } from "../links";
import { ClerkSection } from "./clerk-section";
import { FinalCall } from "./final-call";
import { HistorySection } from "./history-section";
import { HowSection } from "./how-section";
import { LandingFooter } from "./landing-footer";
import { LandingHeader } from "./landing-header";
import { LandingHero } from "./landing-hero";
import styles from "./landing.module.css";
import { MedalShowcase } from "./medal-showcase";
import { StorySection } from "./story-section";
import { TickerBand } from "./ticker-band";

type Props = {
  /** QUICK RACE in the hero (lobby feature). */
  primary: React.ReactNode;
  /** CREATE PRIVATE RACE and JOIN WITH CODE (lobby feature, card 99). */
  entries: React.ReactNode;
  /** The inverted QUICK RACE on the final-call band. */
  finalAction: React.ReactNode;
};

/** The landing in the bible's order (14.1): header, hero, ticker, story, clerk, history, how, final, medal, footer. */
export async function LandingPage({ primary, entries, finalAction }: Props) {
  const [t, viewer] = await Promise.all([getT(), getViewer()]);
  const name = viewer ? fill(t.header.honorific, { name: viewer.name }) : null;
  return (
    <div className={styles.page}>
      <LandingHeader />
      <main className="flex flex-1 flex-col">
        <LandingHero primary={primary} entries={entries} />
        <TickerBand />
        <StorySection />
        <ClerkSection labels={t.landing.clerk} name={name} lockerHref={LINKS.locker} />
        <HistorySection />
        <HowSection />
        <FinalCall action={finalAction} />
        <MedalShowcase />
      </main>
      <LandingFooter />
    </div>
  );
}
