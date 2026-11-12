"use client";

import { LOCALES, type Locale } from "@/i18n/locale";
import type { UpdatePreferences } from "../../actions/update-preferences";
import { SegmentedSection } from "./segmented-choice";
import type { StatusLabels } from "./status-line";
import type { SaveStatus } from "./use-preference-save";

/**
 * Language (#66 C11): each language named in itself (`lang` on its segment). `<html lang>` switches at
 * once; the save re-renders the tree, so every string follows without a reload (ADR 0010).
 */
export function LanguagePicker(props: {
  value: Locale;
  title: string;
  labels: Record<Locale, string>;
  status: StatusLabels;
  action: UpdatePreferences;
  initialStatus?: SaveStatus;
}) {
  return (
    <SegmentedSection
      name="locale"
      title={props.title}
      options={LOCALES.map((value) => ({ value, label: props.labels[value], lang: value }))}
      value={props.value}
      toPatch={(locale) => ({ locale })}
      apply={(locale) => {
        document.documentElement.lang = locale;
      }}
      action={props.action}
      status={props.status}
      initialStatus={props.initialStatus}
    />
  );
}
