"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import {
  FIXTURE_BROWSER_NAMES,
  FIXTURE_BROWSERS,
  FIXTURE_CASE_IDS,
  FIXTURE_CASES,
  FIXTURE_LAYOUTS,
  FIXTURE_OS_NAMES,
  FIXTURE_OSES,
  fixtureFileName,
  fixtureJson,
  guessMachine,
  KEY_EVENT_TYPES,
  recordKeyEvent,
  type FixtureBrowser,
  type FixtureCase,
  type FixtureLayout,
  type FixtureOs,
  type KeyEventFixture,
  type RecordedKeyEvent,
} from "@/features/race";
import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import s from "./key-recorder.module.css";

export type KeyRecorderLabels = Messages["design"]["keys"];

type Copy = "idle" | "copied" | "failed";
const COLUMNS = ["key", "code", "isComposing", "data", "inputType"] as const;

/**
 * The dead-key recorder (#566 C1): one focused input; every keydown, beforeinput, input and composition
 * event on it becomes a log row with key, code, isComposing, data and inputType (null when the event has
 * no such field); COPY FIXTURE copies the fixture JSON (fixture-cases.ts) with the machine from the selects
 * and the committed text as `expected`. Ground truth for the race input handler (#567).
 */
export function KeyRecorder({ labels: l }: { labels: KeyRecorderLabels }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [os, setOs] = useState<FixtureOs>("windows");
  const [browser, setBrowser] = useState<FixtureBrowser>("chrome");
  const [layout, setLayout] = useState<FixtureLayout>("csa");
  const [kase, setCase] = useState<FixtureCase>("circumflex-e");
  const [events, setEvents] = useState<RecordedKeyEvent[]>([]);
  const [committed, setCommitted] = useState("");
  const [copy, setCopy] = useState<Copy>("idle");
  const [ready, setReady] = useState(false);
  const ids = useId();

  useEffect(() => {
    const guess = guessMachine(navigator.userAgent);
    setOs(guess.os);
    setBrowser(guess.browser);
    setReady(true);
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const onEvent = (e: Event) => {
      const row = recordKeyEvent(e);
      if (!row) return;
      setEvents((prev) => [...prev, row]);
      setCommitted(el.value);
      setCopy("idle");
    };
    for (const type of KEY_EVENT_TYPES) el.addEventListener(type, onEvent);
    return () => {
      for (const type of KEY_EVENT_TYPES) el.removeEventListener(type, onEvent);
    };
  }, []);

  const fixture: KeyEventFixture = { os, browser, layout, case: kase, events, expected: committed };
  const json = fixtureJson(fixture);
  const file = fixtureFileName(fixture);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };

  const onClear = () => {
    setEvents([]);
    setCommitted("");
    setCopy("idle");
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.focus();
    }
  };

  const select = <T extends string>(
    key: string,
    label: string,
    value: T,
    options: readonly T[],
    name: (v: T) => string,
    set: (v: T) => void,
  ): ReactNode => (
    <div className={s.row}>
      <label htmlFor={`${ids}-${key}`} className={s.label}>
        {label}
      </label>
      <select
        id={`${ids}-${key}`}
        data-select={key}
        className={s.select}
        value={value}
        onChange={(e) => set(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {name(o)}
          </option>
        ))}
      </select>
    </div>
  );

  const state = events.length === 0 ? "empty" : copy === "copied" ? "copied" : "recording";

  return (
    <div
      data-key-recorder={ready ? "ready" : "server"}
      data-state={state}
      className="flex flex-col gap-6"
    >
      <section aria-labelledby={`${ids}-machine`} className={`${s.docket} ${s.newsprint}`}>
        <div className={s.head}>
          <h2 id={`${ids}-machine`} className={s.tag}>
            {l.machine}
          </h2>
          <span className={s.mono}>{file}</span>
        </div>
        {select("os", l.os, os, FIXTURE_OSES, (v) => FIXTURE_OS_NAMES[v], setOs)}
        {select("browser", l.browser, browser, FIXTURE_BROWSERS, (v) => FIXTURE_BROWSER_NAMES[v], setBrowser)}
        {select("layout", l.layout, layout, FIXTURE_LAYOUTS, (v) => l.layouts[v], setLayout)}
        {select("case", l.case, kase, FIXTURE_CASE_IDS, (v) => l.cases[v], setCase)}
      </section>

      <section aria-labelledby={`${ids}-type`} className={s.docket}>
        <div className={s.head}>
          <label id={`${ids}-type`} htmlFor={`${ids}-input`} className={s.tag}>
            {l.input}
          </label>
          <span data-target className={s.mono}>
            {fill(l.target, { text: FIXTURE_CASES[kase] })}
          </span>
        </div>
        <div className="p-3">
          <input
            ref={inputRef}
            id={`${ids}-input`}
            data-recorder-input
            className={s.input}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
        <div className={s.row}>
          <span className={s.label}>{l.committed}</span>
          <output data-committed htmlFor={`${ids}-input`} className={s.value}>
            {committed}
          </output>
        </div>
      </section>

      <section aria-labelledby={`${ids}-log`} className={s.docket}>
        <div className={s.head}>
          <h2 id={`${ids}-log`} className={s.tag}>
            {l.log}
          </h2>
          <span data-count className={s.mono}>
            {fill(l.count, { n: events.length })}
          </span>
        </div>
        {events.length === 0 ? (
          <p data-empty className={s.empty}>
            {l.empty}
          </p>
        ) : (
          <div className={s.scroll} tabIndex={0} aria-labelledby={`${ids}-log`} role="region">
            <table data-log className={s.table}>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">type</th>
                  {COLUMNS.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} data-event={e.type}>
                    <td>{String(i + 1).padStart(2, "0")}</td>
                    <td>{e.type}</td>
                    {COLUMNS.map((c) => (
                      <td key={c} data-field={c} className={e[c] === null ? s.null : undefined}>
                        {e[c] === null ? "null" : JSON.stringify(e[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={onCopy} disabled={events.length === 0}>
            {copy === "copied" ? l.copied : l.copy}
          </Button>
          <Button size="lg" variant="secondary" onClick={onClear} disabled={events.length === 0}>
            {l.clear}
          </Button>
        </div>
        <div role="status" aria-live="polite">
          {copy === "copied" && <p className={s.status}>{fill(l.copiedStatus, { file })}</p>}
        </div>
        {copy === "failed" && (
          <p role="alert" className={s.error}>
            <span className={s.errorPrefix}>{l.returned}</span> {l.copyFailed}
          </p>
        )}
      </div>

      <section aria-labelledby={`${ids}-fixture`} className={`${s.docket} ${s.newsprint}`}>
        <div className={s.head}>
          <h2 id={`${ids}-fixture`} className={s.tag}>
            {l.fixture}
          </h2>
          <span className={s.mono}>{file}</span>
        </div>
        <pre data-fixture className={s.json} tabIndex={0}>
          {json}
        </pre>
      </section>
    </div>
  );
}
