"use client";

import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { Star } from "@/components/ui";
import styles from "./home.module.css";

/** What PLAY and PRACTICE answer (lobby `quickRace`, `createPracticeLobby`). */
export type EntryResult = { ok: true; code: string } | { ok: false; error: string };

/** One menu entry: a link, or an action that seats the viewer and lands on `/lobby/<code>`. */
export type HomeEntry = {
  id: string;
  label: string;
  /** One static line per language (#943 C4): no live figures. */
  description: string;
  /** The gold `<n> NEW` tag (part of the entry's accessible name). */
  tag?: string;
  activate: { href: string } | { action: () => Promise<EntryResult>; pendingLabel: string };
};

export type HomeMenuLabels = {
  menuLabel: string;
  keys: {
    label: string;
    arrows: string;
    navigate: string;
    enter: string;
    select: string;
    esc: string;
    signOut: string;
    signIn: string;
  };
  errors: { prefix: string; unavailable: string; generic: string };
};

export type HomeMenuProps = {
  entries: readonly HomeEntry[];
  labels: HomeMenuLabels;
  /** An account gets ESC SIGN OUT (the `signOut` action); a guest a SIGN IN link and no Escape. */
  signOut: (() => Promise<void>) | null;
  signInHref: string;
  /** `v<version>`, from the root package.json. */
  version: string;
  /** The players-online figure, streamed by the route (nothing when unknown). */
  online?: ReactNode;
  /** The mission docket, streamed by the route. */
  mission?: ReactNode;
  /** `/design` specimens: an entry shown pending or with its error line, no focus on load. */
  specimen?: { pending?: string; error?: string };
};

const WIDE = "(min-width: 768px)";

/**
 * Runs PLAY or PRACTICE: the room to land on, or the error line to show (the entry is enabled again).
 * The lobby's own buttons map their answers the same way (`race-server-unavailable` has its line).
 */
export async function runEntryAction(
  action: () => Promise<EntryResult>,
  errors: HomeMenuLabels["errors"],
): Promise<{ href: string } | { error: string }> {
  try {
    const result = await action();
    if (result.ok) return { href: `/lobby/${result.code}` };
    return { error: result.error === "race-server-unavailable" ? errors.unavailable : errors.generic };
  } catch {
    return { error: errors.generic };
  }
}

/**
 * The Home menu (#943 part A, bible "Home menu (extension, #943)"): one roving-tabindex group of entries
 * given as data, the description line of the selected entry (a polite live region), and the key-hint
 * bar. ↑/↓ move and wrap, Enter or Space activate, hover selects, Escape signs an account out (focus in
 * the menu). The only client leaf of the screen; everything streamed comes in as props.
 */
export function HomeMenu({
  entries,
  labels,
  signOut,
  signInHref,
  version,
  online,
  mission,
  specimen,
}: HomeMenuProps) {
  const router = useRouter();
  const [selected, setSelected] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(specimen?.pending ?? null);
  const [error, setError] = useState<string | null>(specimen?.error ?? null);
  const [, startTransition] = useTransition();
  const items = useRef<(HTMLAnchorElement | HTMLButtonElement | null)[]>([]);
  const signOutForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (specimen) return;
    if (window.matchMedia(WIDE).matches) items.current[0]?.focus();
  }, [specimen]);

  const move = useCallback(
    (to: number) => {
      const n = entries.length;
      const i = ((to % n) + n) % n;
      setSelected(i);
      items.current[i]?.focus();
    },
    [entries.length],
  );

  const run = (entry: HomeEntry) => {
    const activate = entry.activate;
    if (!("action" in activate) || pendingId) return;
    setError(null);
    setPendingId(entry.id);
    startTransition(async () => {
      const outcome = await runEntryAction(activate.action, labels.errors);
      if ("href" in outcome) {
        router.push(outcome.href);
        return;
      }
      setError(outcome.error);
      setPendingId(null);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(selected + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(selected - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      items.current[selected]?.click();
    } else if (event.key === "Escape" && signOut) {
      event.preventDefault();
      signOutForm.current?.requestSubmit();
    }
  };

  const current = entries[selected];

  return (
    <>
      <nav aria-label={labels.menuLabel} className={styles.menu} data-home-menu>
        <ul className={styles.entries} onKeyDown={onKeyDown}>
          {entries.map((entry, i) => {
            const isSelected = i === selected;
            const pending = pendingId === entry.id;
            const common = {
              ref: (el: HTMLAnchorElement | HTMLButtonElement | null) => {
                items.current[i] = el;
              },
              className: styles.entry,
              tabIndex: isSelected ? 0 : -1,
              "data-selected": isSelected ? "true" : "false",
              "data-entry": entry.id,
              onFocus: () => setSelected(i),
              onMouseEnter: () => setSelected(i),
            };
            const body = (
              <>
                {isSelected ? (
                  <Star size={22} tone="gold" rotate={-8} className={styles.entryStar} />
                ) : null}
                <span className={styles.entryLabel}>
                  {pending && "action" in entry.activate
                    ? entry.activate.pendingLabel
                    : entry.label}
                </span>
                {entry.tag ? <span className={styles.tag}>{entry.tag}</span> : null}
              </>
            );
            return (
              <li key={entry.id}>
                {"href" in entry.activate ? (
                  <a {...common} href={entry.activate.href}>
                    {body}
                  </a>
                ) : (
                  <button
                    {...common}
                    type="button"
                    aria-disabled={pendingId !== null ? "true" : undefined}
                    aria-busy={pending ? "true" : undefined}
                    data-pending={pending ? "true" : undefined}
                    onClick={() => run(entry)}
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {error ? (
          <p role="alert" className={styles.errorLine}>
            <span className={styles.errorPrefix}>{labels.errors.prefix}</span> {error}
          </p>
        ) : null}
        <p className={styles.description} aria-live="polite" data-home-description>
          {current?.description}
        </p>
      </nav>
      {mission}
      <div className={styles.hintBar} role="group" aria-label={labels.keys.label} data-key-hints>
        <span className={styles.hint}>
          <span className={styles.cap} aria-hidden="true">
            {labels.keys.arrows}
          </span>
          {labels.keys.navigate}
        </span>
        <span className={styles.hint}>
          <span className={styles.cap} aria-hidden="true">
            {labels.keys.enter}
          </span>
          {labels.keys.select}
        </span>
        {signOut ? (
          <form ref={signOutForm} action={signOut} className={styles.hintForm}>
            <button type="submit" className={styles.hintControl} data-sign-out>
              <span className={styles.cap} aria-hidden="true">
                {labels.keys.esc}
              </span>
              {labels.keys.signOut}
            </button>
          </form>
        ) : (
          <a href={signInHref} className={styles.hintControl} data-sign-in>
            {labels.keys.signIn}
          </a>
        )}
        <span className={styles.meta} data-version>
          {version}
          {online}
        </span>
      </div>
    </>
  );
}
