import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import type { KeyFile } from "../view/key-file";
import { initialKey } from "../view/key-sheet";
import { KeySheet, type KeySheetKey, type KeySheetLabels } from "./key-sheet";
import profile from "./profile.module.css";

/**
 * "Fiche par touche" (#963, bible 14.3, reference `Profil.dc.html` `INTERROGATOIRE INDIVIDUEL`): the
 * section head (kicker, title, intro naming the goal), then the `KeySheet` client leaf with only what it
 * draws of the key file. Absent when no key has a speed.
 */
export function KeySheetSection({
  keyFile,
  labels,
  locale,
  id,
  heading: Heading,
}: {
  keyFile: KeyFile;
  labels: KeySheetLabels;
  locale: Locale;
  id: string;
  heading: "h2" | "h3" | "h4";
}) {
  const initial = initialKey(keyFile);
  if (!initial) return null;
  const keys: KeySheetKey[] = keyFile.keys.map((k) => ({
    char: k.char,
    state: k.state,
    series: k.series,
    latestWpm: k.latestWpm,
    bestWpm: k.bestWpm,
    averageWpm: k.averageWpm,
    learningRate: k.learningRate,
    errorRate: k.errorRate,
  }));
  return (
    <section aria-labelledby={id} data-section="key-sheet">
      <div className={profile.head}>
        <div>
          <p className={profile.kicker}>{labels.kicker}</p>
          <Heading id={id} className={profile.h2}>
            {labels.title}
          </Heading>
        </div>
        <p className={profile.intro}>{fill(labels.intro, { goal: keyFile.goal })}</p>
      </div>
      <KeySheet keys={keys} initial={initial} goal={keyFile.goal} labels={labels} locale={locale} />
    </section>
  );
}
