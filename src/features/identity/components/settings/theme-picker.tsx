"use client";

import type { UpdatePreferences } from "../../actions/update-preferences";
import { PREFERENCE_THEMES, type PreferenceTheme } from "../../schema";
import { SegmentedSection } from "./segmented-choice";
import type { StatusLabels } from "./status-line";
import type { SaveStatus } from "./use-preference-save";

/** Puts a theme on the page at once (tokens.css): `SYSTEM` drops `data-theme` so the OS decides. */
function applyTheme(theme: PreferenceTheme) {
  const root = document.documentElement;
  if (theme === "SYSTEM") delete root.dataset.theme;
  else root.dataset.theme = theme.toLowerCase();
}

/** Theme (#66 C11): light, dark or system; applied before the save answers, filed with the cookie. */
export function ThemePicker(props: {
  value: PreferenceTheme;
  title: string;
  labels: Record<PreferenceTheme, string>;
  status: StatusLabels;
  action: UpdatePreferences;
  initialStatus?: SaveStatus;
}) {
  return (
    <SegmentedSection
      name="theme"
      title={props.title}
      options={PREFERENCE_THEMES.map((value) => ({ value, label: props.labels[value] }))}
      value={props.value}
      toPatch={(theme) => ({ theme })}
      apply={applyTheme}
      action={props.action}
      status={props.status}
      initialStatus={props.initialStatus}
    />
  );
}
