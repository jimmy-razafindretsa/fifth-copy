import { GUIDE_CHARS, guideHref } from "@/features/guide/client";
import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import { cn } from "@/lib/cn";
import { accentsRowOf } from "../view/accents-row";
import type { CharCount } from "../view/key-file";
import { circleSize, coreSize } from "../view/keyboard-map";
import { keyName, type KeyboardMapLabels } from "./keyboard-map";
import own from "./accents-row.module.css";
import map from "./keyboard-map.module.css";
import profile from "./profile.module.css";

export type AccentsRowLabels = Messages["profile"]["accents"];

/** The row's characters: the guide's, in its order (é è ê ë à â ç ù û ô î ï œ æ « » €). */
export const ACCENT_CHARS: readonly string[] = GUIDE_CHARS.map((c) => c.char);

/**
 * "Rangée des accents" / "Accents row" (#999 C55, spec 13.2; bible 14.3, extending the keyboard map of
 * #324): the French accents and special characters as one wrapping row of the map's keys (paper key,
 * violet circle, red core; untyped newsprint), each a link to its guide entry `/guide#<char>` (C29),
 * named by the map's sentence. Server-rendered, nothing moves.
 */
export function AccentsRow({
  byChar,
  labels,
  mapLabels,
  locale,
  id,
  heading: Heading,
}: {
  byChar: Readonly<Record<string, CharCount>>;
  labels: AccentsRowLabels;
  mapLabels: KeyboardMapLabels;
  locale: Locale;
  id: string;
  heading: "h2" | "h3" | "h4";
}) {
  const keys = accentsRowOf(byChar, ACCENT_CHARS);
  return (
    <section aria-labelledby={id} data-section="accents">
      <div className={profile.head}>
        <div>
          <p className={profile.kicker}>{labels.kicker}</p>
          <Heading id={id} className={profile.h2}>
            {labels.title}
          </Heading>
        </div>
        <p className={profile.intro}>{labels.intro}</p>
      </div>
      <div className={map.frame}>
        <ul aria-label={labels.row} className={own.board} data-accents-row="">
          {keys.map((key) => (
            <li key={key.char} className={own.slot}>
              <a
                href={guideHref(key.char) ?? undefined}
                aria-label={fill(mapLabels.guide, { name: keyName(key, mapLabels, locale) })}
                className={cn(map.key, own.key, !key.typed && map.untyped, map.guideKey)}
                data-key={key.char}
                data-key-guide=""
                data-key-typed={key.typed ? "true" : "false"}
              >
                <span className={cn(map.cap, own.cap)} data-key-cap="">
                  {key.cap}
                </span>
                {key.typed ? (
                  <span
                    className={map.circle}
                    style={{ width: `${circleSize(key.share)}%` }}
                    data-key-circle=""
                  >
                    <span
                      className={map.core}
                      style={{ width: `${coreSize(key.errorRate)}%` }}
                      data-key-core=""
                    />
                  </span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
        <ul className={cn(map.legend, own.legend)} data-accents-legend="">
          <li>
            <i className={map.sizeSwatch} aria-hidden="true" />
            {labels.legendSize}
          </li>
          <li>
            <i className={map.coreSwatch} aria-hidden="true" />
            {mapLabels.legendCore}
          </li>
        </ul>
      </div>
    </section>
  );
}
