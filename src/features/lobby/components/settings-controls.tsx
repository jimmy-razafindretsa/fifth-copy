import type { ReactNode } from "react";
import {
  difficultySchema,
  raceLanguageSchema,
  textTypeSchema,
  type RaceSettings,
} from "@fifth-copy/protocol";
import { cn } from "@/lib/cn";
import { InlineError } from "./inline-error";
import { fill } from "./lobby-labels";
import {
  settingLabelId,
  type SettingControls,
  type SettingsLabels,
  type SettingSubRows,
} from "./settings-docket";
import {
  BOUNDS,
  hostRows,
  type FormError,
  type FormKey,
  type FormState,
  type RawValue,
} from "./settings-form";
import styles from "./lobby.module.css";

/**
 * The host's controls in the `FORM 5-L` rows (#110, bible 14.3 "Host settings form"): 7.1 segmented
 * toggles, 7.2 inputs, the 7.4 inline error line. No hooks, so every state renders in static-markup
 * tests; the waiting room owns the form state and the socket. The option lists come from the protocol
 * schemas, the words from the docket's catalog.
 */

export const SETTINGS_ERROR_ID = "lobby-settings-error";

type Ctx = {
  /** A change is on its way: every control is unavailable (`aria-disabled`, keeping focus) until the ack. */
  pending: boolean;
  /** The control of the refused row points at the error line. */
  describedBy: (key: FormKey) => string | undefined;
  /** Remounts the inputs on each refusal, so they show the last broadcast value again. */
  revision: number;
  onChange?: (key: FormKey, raw: RawValue) => void;
};

type Option = { value: string; label: string };

/** Bible 7.1 segmented toggle: one group named by its row label, the current value pressed. */
function Segmented({
  name,
  options,
  value,
  ctx,
}: {
  name: FormKey;
  options: ReadonlyArray<Option>;
  value: string;
  ctx: Ctx;
}) {
  return (
    <div
      role="group"
      aria-labelledby={settingLabelId(name)}
      aria-describedby={ctx.describedBy(name)}
      className={styles.segmented}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          aria-disabled={ctx.pending || undefined}
          className={styles.segment}
          onClick={() => (ctx.pending ? undefined : ctx.onChange?.(name, o.value))}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Booleans as `ON | OFF`, the docket's own words. */
function OnOff({
  name,
  value,
  ctx,
  labels,
}: {
  name: FormKey;
  value: boolean;
  ctx: Ctx;
  labels: SettingsLabels;
}) {
  return (
    <Segmented
      name={name}
      value={value ? "on" : "off"}
      options={[
        { value: "on", label: labels.on },
        { value: "off", label: labels.off },
      ]}
      ctx={{ ...ctx, onChange: (key, raw) => ctx.onChange?.(key, raw === "on") }}
    />
  );
}

/**
 * Bible 7.2 input in a row: commits on Enter and on blur (Enter blurs), never per keystroke, so one
 * change is one patch. Uncontrolled; its key carries the broadcast value and the refusal count.
 */
function Field({
  name,
  value,
  ctx,
  type,
  labelledBy,
  bounds,
  disabled = false,
}: {
  name: FormKey;
  value: string;
  ctx: Ctx;
  type: "number" | "text";
  labelledBy?: string;
  bounds?: { min: number; max: number };
  disabled?: boolean;
}) {
  return (
    <input
      key={`${value}|${ctx.revision}`}
      type={type}
      inputMode={type === "number" ? "numeric" : undefined}
      min={bounds?.min}
      max={bounds?.max}
      step={type === "number" ? 1 : undefined}
      defaultValue={value}
      autoComplete="off"
      autoCapitalize={type === "text" ? "off" : undefined}
      spellCheck={type === "text" ? false : undefined}
      disabled={disabled}
      readOnly={ctx.pending}
      aria-disabled={ctx.pending || undefined}
      aria-labelledby={labelledBy ?? settingLabelId(name)}
      aria-describedby={ctx.describedBy(name)}
      className={cn(styles.field, type === "number" && styles.fieldNumber)}
      onBlur={(e) => (ctx.pending ? undefined : ctx.onChange?.(name, e.currentTarget.value))}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/** TIMER: the pressed `NO TIMER` toggle beside the minutes; released, it starts at the schema minimum. */
function Timer({
  timerS,
  ctx,
  labels,
}: {
  timerS: number | null;
  ctx: Ctx;
  labels: SettingsLabels;
}) {
  const none = timerS === null;
  const unitId = `${settingLabelId("timerS")}-unit`;
  return (
    <div className={styles.timer}>
      <button
        type="button"
        aria-pressed={none}
        aria-disabled={ctx.pending || undefined}
        aria-describedby={ctx.describedBy("timerS")}
        className={cn(styles.segment, styles.single)}
        onClick={() =>
          ctx.pending
            ? undefined
            : ctx.onChange?.("timerS", none ? String(BOUNDS.minutes.min) : null)
        }
      >
        {labels.timer.none}
      </button>
      <span className={styles.minutes}>
        <Field
          name="timerS"
          type="number"
          value={String(none ? BOUNDS.minutes.min : timerS / 60)}
          bounds={BOUNDS.minutes}
          labelledBy={`${settingLabelId("timerS")} ${unitId}`}
          disabled={none}
          ctx={ctx}
        />
        <span id={unitId} className={styles.unit}>
          {labels.form.minutes}
        </span>
      </span>
    </div>
  );
}

const PRESETS = difficultySchema.options[0].shape.level.options;
const RECIPE = difficultySchema.options[1].shape;

function errorText(labels: SettingsLabels, error: FormError): string {
  const text = labels.form.errors[error];
  if (error === "words") return fill(text, BOUNDS.words);
  if (error === "timer") return fill(text, BOUNDS.minutes);
  if (error === "too-many-letters") return fill(text, BOUNDS.letters);
  return text;
}

/**
 * The host's form for these settings, as the docket's seams: a control per edited row, the custom
 * recipe rows under DIFFICULTY, the busy row and the error line. The rows themselves (which show, in
 * which order) stay the docket's; `hostRows` says which of them get a control.
 */
export function hostForm({
  settings,
  labels,
  form,
  revision,
  prefix,
  onChange,
}: {
  settings: RaceSettings;
  labels: SettingsLabels;
  form: FormState;
  revision: number;
  /** The rejection word of the inline error line (`RETURNED ·`). */
  prefix: string;
  onChange?: (key: FormKey, raw: RawValue) => void;
}): { controls: SettingControls; after: SettingSubRows; busy?: string; error?: ReactNode } {
  const pending = form.status === "pending";
  const refused = form.status === "error" ? form : null;
  const ctx: Ctx = {
    pending,
    describedBy: (key) => (refused?.key === key ? SETTINGS_ERROR_ID : undefined),
    revision,
    onChange,
  };
  const seg = (name: FormKey, value: string, options: ReadonlyArray<Option>) => (
    <Segmented name={name} value={value} options={options} ctx={ctx} />
  );
  const onOff = (name: FormKey, value: boolean) => (
    <OnOff name={name} value={value} ctx={ctx} labels={labels} />
  );
  const d = settings.difficulty;

  const all: Record<FormKey, () => ReactNode> = {
    language: () =>
      seg(
        "language",
        settings.language,
        raceLanguageSchema.options.map((v) => ({ value: v, label: labels.language[v] })),
      ),
    textType: () =>
      seg(
        "textType",
        settings.textType,
        textTypeSchema.options.map((v) => ({ value: v, label: labels.textType[v] })),
      ),
    wordCount: () => (
      <Field
        name="wordCount"
        type="number"
        value={String(settings.wordCount)}
        bounds={BOUNDS.words}
        ctx={ctx}
      />
    ),
    accentEveryWord: () => onOff("accentEveryWord", settings.accentEveryWord),
    difficulty: () =>
      seg(
        "difficulty",
        d.level,
        [...PRESETS, "custom" as const].map((v) => ({ value: v, label: labels.difficulty[v] })),
      ),
    "difficulty.wordLength": () =>
      d.level === "custom"
        ? seg(
            "difficulty.wordLength",
            d.wordLength,
            RECIPE.wordLength.options.map((v) => ({ value: v, label: labels.form.wordLength[v] })),
          )
        : null,
    "difficulty.rareLetters": () =>
      d.level === "custom" ? onOff("difficulty.rareLetters", d.rareLetters) : null,
    "difficulty.punctuationDensity": () =>
      d.level === "custom"
        ? seg(
            "difficulty.punctuationDensity",
            d.punctuationDensity,
            RECIPE.punctuationDensity.options.map((v) => ({
              value: v,
              label: labels.form.punctuationDensity[v],
            })),
          )
        : null,
    practiceLetters: () => (
      <Field
        name="practiceLetters"
        type="text"
        value={settings.practiceLetters.join("")}
        ctx={ctx}
      />
    ),
    includeNumbers: () => onOff("includeNumbers", settings.includeNumbers),
    includeSymbols: () => onOff("includeSymbols", settings.includeSymbols),
    includePunctuation: () => onOff("includePunctuation", settings.includePunctuation),
    timerS: () => <Timer timerS={settings.timerS} ctx={ctx} labels={labels} />,
    errorMode: () =>
      seg("errorMode", settings.errorMode, [
        { value: "continue", label: labels.errorMode.continue },
        { value: "block", label: labels.errorMode.block },
      ]),
    backspace: () => onOff("backspace", settings.backspace),
    bonuses: () => onOff("bonuses", settings.bonuses),
  };

  const controls: SettingControls = {};
  const recipe: Array<{ key: string; label: string; control: ReactNode }> = [];
  for (const key of hostRows(settings)) {
    if (key.startsWith("difficulty.")) {
      const field = key.slice("difficulty.".length) as keyof SettingsLabels["form"]["labels"];
      recipe.push({ key, label: labels.form.labels[field], control: all[key]() });
    } else {
      controls[key as keyof SettingControls] = all[key]();
    }
  }

  return {
    controls,
    after: recipe.length ? { difficulty: recipe } : {},
    busy: pending ? form.key : undefined,
    error: refused ? (
      <div className={styles.error}>
        <InlineError id={SETTINGS_ERROR_ID} prefix={prefix}>
          {errorText(labels, refused.error)}
        </InlineError>
      </div>
    ) : undefined,
  };
}
