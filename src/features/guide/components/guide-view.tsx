import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import type { KeyboardLayoutId } from "@/features/identity";
import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import { cn } from "@/lib/cn";
import { GUIDE_PATH } from "../chars";
import {
  GUIDE_LAYOUTS,
  GUIDE_MODIFIERS,
  GUIDE_OSES,
  pairVerified,
  shownCombination,
  type GuideCombination,
  type GuideEntry,
  type GuideOs,
} from "../content";
import styles from "./guide.module.css";

export type GuideLabels = Messages["guide"];

/** Where the shown OS came from: the request (`detected`), a `?os=` pick (`chosen`), or none (unknown). */
export type GuideOsSource = "detected" | "chosen" | null;

export type GuideDesk = {
  layout: KeyboardLayoutId;
  /** The OS shown; null = the unknown-OS fallback (every OS per character). */
  os: GuideOs | null;
  osSource: GuideOsSource;
};

export type GuideViewProps = {
  labels: GuideLabels;
  /** The layouts' names as the settings page prints them. */
  layoutNames: Record<KeyboardLayoutId, string>;
  content: readonly GuideEntry[];
  desk: GuideDesk;
  header: ReactNode;
};

/** A `/guide?layout=…&os=…` link; the OS stays out of the URL while it is only detected. */
function deskHref(layout: KeyboardLayoutId, os: GuideOs | null): string {
  const params = new URLSearchParams({ layout });
  if (os) params.set("os", os);
  return `${GUIDE_PATH}?${params.toString()}`;
}

function keyLabel(key: string, labels: GuideLabels): string {
  if ((GUIDE_MODIFIERS as readonly string[]).includes(key)) {
    return labels.keys[key as keyof GuideLabels["keys"]];
  }
  const numpad = /^numpad(\d+)$/.exec(key);
  if (numpad) return `${numpad[1]} (${labels.keys.numpad})`;
  return key.length > 1 ? key.toUpperCase() : key;
}

/** The strokes as key caps: `[Option]+[E]` then `[E]`. */
function Keys({ combination, labels }: { combination: GuideCombination; labels: GuideLabels }) {
  return (
    <kbd className={styles.keys} data-guide-keys="">
      {combination.strokes.map((stroke, i) => (
        <span key={i} className={styles.stroke}>
          {i > 0 ? <span className={styles.then}>{labels.then}</span> : null}
          {stroke.map((key, k) => (
            <span key={k} className={styles.strokeKeys}>
              {k > 0 ? (
                <span className={styles.plus} aria-hidden="true">
                  +
                </span>
              ) : null}
              <kbd className={styles.cap}>{keyLabel(key, labels)}</kbd>
            </span>
          ))}
        </span>
      ))}
    </kbd>
  );
}

function Segments<T extends string>({
  id,
  options,
  current,
  href,
  name,
  attr,
}: {
  id: string;
  options: readonly T[];
  current: T | null;
  href: (option: T) => string;
  name: (option: T) => string;
  attr: string;
}) {
  return (
    <div role="group" aria-labelledby={id} className={styles.switch}>
      {options.map((option) => (
        <Link
          key={option}
          href={href(option)}
          scroll={false}
          replace
          className={styles.option}
          aria-current={option === current ? "true" : undefined}
          {...{ [attr]: option }}
        >
          {name(option)}
        </Link>
      ))}
    </div>
  );
}

/**
 * "How to type it" (#999 C26, bible 14.3 "How to type special characters"): the privacy page's form file
 * (kicker, H1, intro) with the desk docket (keyboard and system as 7.1 segmented links), then on paper the
 * characters' index docket and one 7.4 docket per character, anchored `#c-cedilla`. A combination shows
 * only when checked on a real machine (C27); every other pair reads `NOT CHECKED YET`. Pure: the page
 * hands in the desk it read.
 */
export function GuideView({ labels, layoutNames, content, desk, header }: GuideViewProps) {
  const oses = desk.os ? [desk.os] : GUIDE_OSES;
  const verified = oses.some((os) => pairVerified(content, desk.layout, os));
  const layoutName = layoutNames[desk.layout];
  return (
    <>
      {header}
      <main
        className={styles.screen}
        id="top"
        data-guide-layout={desk.layout}
        data-guide-os={desk.os ?? "unknown"}
      >
        <header className={styles.file}>
          <div className={styles.kicker}>{labels.kicker}</div>
          <h1 className={styles.title}>{labels.heading}</h1>
          <p className={styles.intro}>{labels.intro}</p>
          <div className={styles.desk}>
            <div className={styles.deskHead}>
              <span className={styles.tag}>{labels.deskTag}</span>
            </div>
            <div className={styles.deskRow}>
              <span id="guide-layout" className={styles.deskLabel}>
                {labels.layout}
              </span>
              <Segments
                id="guide-layout"
                options={GUIDE_LAYOUTS}
                current={desk.layout}
                href={(layout) => deskHref(layout, desk.osSource === "chosen" ? desk.os : null)}
                name={(layout) => layoutNames[layout]}
                attr="data-guide-layout-option"
              />
            </div>
            <div className={styles.deskRow}>
              <span id="guide-os" className={styles.deskLabel}>
                {labels.os}
              </span>
              <div className={styles.deskValue}>
                <Segments
                  id="guide-os"
                  options={GUIDE_OSES}
                  current={desk.os}
                  href={(os) => deskHref(desk.layout, os)}
                  name={(os) => labels.osNames[os]}
                  attr="data-guide-os-option"
                />
                <p
                  className={cn(styles.osState, !desk.os && styles.osUnknown)}
                  data-guide-os-state={desk.osSource ?? "unknown"}
                >
                  {desk.osSource === "detected"
                    ? labels.detected
                    : desk.osSource === "chosen"
                      ? labels.chosen
                      : labels.unknown}
                </p>
              </div>
            </div>
          </div>
        </header>

        <div className={styles.body}>
          <nav className={styles.index} aria-label={labels.indexLabel}>
            <div className={styles.deskHead}>
              <span className={styles.tag}>{labels.indexTag}</span>
            </div>
            <ul className={styles.indexList}>
              {content.map((entry) => (
                <li key={entry.anchor}>
                  <a
                    href={`#${entry.anchor}`}
                    className={styles.indexLink}
                    aria-label={`${entry.char} · ${labels.chars[entry.anchor as keyof GuideLabels["chars"]]}`}
                  >
                    {entry.char}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {verified ? null : (
            <EmptyState
              className={styles.empty}
              title={labels.unverifiedTag}
              description={fill(desk.os ? labels.unverifiedPair : labels.unverifiedLayout, {
                layout: layoutName,
                os: desk.os ? labels.osNames[desk.os] : "",
              })}
            />
          )}

          <div className={styles.grid}>
            {content.map((entry) => {
              const name = labels.chars[entry.anchor as keyof GuideLabels["chars"]];
              return (
                <section
                  key={entry.anchor}
                  id={entry.anchor}
                  className={styles.entry}
                  aria-labelledby={`${entry.anchor}-title`}
                  data-guide-char={entry.char}
                >
                  <div className={styles.entryHead}>
                    <span className={styles.glyph} aria-hidden="true">
                      {entry.char}
                    </span>
                    <h2 id={`${entry.anchor}-title`} className={styles.name}>
                      <span className="sr-only">{entry.char} · </span>
                      {name}
                    </h2>
                  </div>
                  <dl className={styles.rows}>
                    {oses.map((os) => {
                      const shown = shownCombination(entry, desk.layout, os);
                      return (
                        <div
                          key={os}
                          className={styles.row}
                          data-guide-pair={`${desk.layout}/${os}`}
                        >
                          <dt>{labels.osNames[os]}</dt>
                          <dd>
                            {shown ? (
                              <Keys combination={shown} labels={labels} />
                            ) : (
                              <span className={styles.unchecked} data-guide-unchecked="">
                                {labels.unverifiedTag}
                              </span>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </section>
              );
            })}
          </div>
          <a href="#top" className={styles.backToTop}>
            {labels.backToTop}
          </a>
        </div>
      </main>
    </>
  );
}
