"use client";

import { useId, useState, useSyncExternalStore, useTransition } from "react";
import type { UpdatePreferences } from "../actions/update-preferences";
import { keyboardLayoutIds, type KeyboardLayoutId } from "../keyboard/layouts";
import { Button } from "@/components/ui";
import { DocketDialog, dialogStyles } from "./dialog/docket-dialog";
import { KeyboardPreview } from "./settings/layout-picker";
import { SaveError, SaveState, type StatusLabels } from "./settings/status-line";
import type { SaveStatus } from "./settings/use-preference-save";
import settings from "./settings/settings.module.css";

/** "Ask me later" lasts for the browser session (#70 C1): a new session asks again. */
export const LAYOUT_PROMPT_KEY = "fc_layout_prompt";

const noSubscribe = () => () => {};
function snoozed(): boolean {
  try {
    return window.sessionStorage.getItem(LAYOUT_PROMPT_KEY) === "later";
  } catch {
    return false;
  }
}
function snooze() {
  try {
    window.sessionStorage.setItem(LAYOUT_PROMPT_KEY, "later");
  } catch {
    // storage blocked: the prompt simply closes for this page
  }
}

export type LayoutPromptLabels = {
  form: string;
  tag: string;
  title: string;
  body: string;
  later: string;
};

/**
 * The first-race keyboard prompt (#70, R179, R180): mounted on a lobby page while the viewer has no
 * layout on file, it asks once which keyboard is on the desk, with #66's four layout cards. Choosing
 * one files it through `updatePreferences` and closes; "Ask me later" (or Escape) closes it for the
 * browser session. States: open, pending (the chosen card filing), closed; a refused save keeps it open
 * with the 7.4 inline error line. `/design` passes `alwaysOpen` to show it whatever the session says.
 */
export function LayoutPrompt({
  action,
  labels,
  names,
  status: statusLabels,
  alwaysOpen = false,
  initialStatus = "idle",
  initialValue = null,
}: {
  action: UpdatePreferences;
  labels: LayoutPromptLabels;
  names: Record<KeyboardLayoutId, string>;
  status: StatusLabels;
  alwaysOpen?: boolean;
  initialStatus?: SaveStatus;
  initialValue?: KeyboardLayoutId | null;
}) {
  const id = useId();
  const later = useSyncExternalStore(noSubscribe, snoozed, () => true);
  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const [closed, setClosed] = useState(false);
  const [value, setValue] = useState<KeyboardLayoutId | null>(initialValue);
  const [status, setStatus] = useState<SaveStatus>(initialStatus);
  const [, startTransition] = useTransition();
  const open = hydrated && !closed && (alwaysOpen || !later);

  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  const errorId = `${id}-error`;

  const askLater = () => {
    if (status === "pending") return;
    snooze();
    setClosed(true);
  };

  const choose = (layout: KeyboardLayoutId) => {
    if (status === "pending") return;
    setValue(layout);
    setStatus("pending");
    startTransition(async () => {
      try {
        const result = await action({ layout });
        if (result.ok) {
          setStatus("saved");
          setClosed(true);
        } else {
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    });
  };

  return (
    <DocketDialog
      open={open}
      onCancel={askLater}
      titleId={titleId}
      describedBy={bodyId}
      form={labels.form}
      tag={labels.tag}
      name="layout"
    >
      <div className={dialogStyles.body}>
        <div className={settings.sectionHead}>
          <h2 id={titleId} className={dialogStyles.title}>
            {labels.title}
          </h2>
          <SaveState status={status} labels={statusLabels} />
        </div>
        <p id={bodyId} className={settings.hint}>
          {labels.body}
        </p>
        <div
          role="radiogroup"
          aria-labelledby={titleId}
          aria-describedby={status === "error" ? errorId : undefined}
          aria-busy={status === "pending" || undefined}
          className={`${settings.group} ${settings.layouts}`}
        >
          {keyboardLayoutIds.map((layout) => (
            <label key={layout} className={settings.option} data-layout={layout}>
              <input
                type="radio"
                className={settings.radio}
                name={`${id}-layout`}
                value={layout}
                checked={value === layout}
                disabled={status === "pending" && value !== layout}
                onChange={() => choose(layout)}
              />
              <span className={settings.optionName}>{names[layout]}</span>
              <KeyboardPreview layout={layout} />
            </label>
          ))}
        </div>
        {status === "error" && <SaveError id={errorId} labels={statusLabels} />}
      </div>
      <div className={dialogStyles.actions}>
        <Button variant="secondary" size="lg" onClick={askLater} disabled={status === "pending"}>
          {labels.later}
        </Button>
      </div>
    </DocketDialog>
  );
}
