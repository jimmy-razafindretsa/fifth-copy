"use client";

import type { UpdatePreferences } from "../../actions/update-preferences";
import { SegmentedSection } from "./segmented-choice";
import type { StatusLabels } from "./status-line";
import type { SaveStatus } from "./use-preference-save";

type OnOff = "on" | "off";

/** Sound (#66): the 7.1 `ON | OFF` toggle of the race settings form, filed as a boolean. */
export function SoundToggle(props: {
  value: boolean;
  title: string;
  hint: string;
  labels: Record<OnOff, string>;
  status: StatusLabels;
  action: UpdatePreferences;
  initialStatus?: SaveStatus;
}) {
  return (
    <SegmentedSection<OnOff>
      name="sound"
      title={props.title}
      hint={props.hint}
      options={[
        { value: "on", label: props.labels.on },
        { value: "off", label: props.labels.off },
      ]}
      value={props.value ? "on" : "off"}
      toPatch={(choice) => ({ sound: choice === "on" })}
      action={props.action}
      status={props.status}
      initialStatus={props.initialStatus}
    />
  );
}
