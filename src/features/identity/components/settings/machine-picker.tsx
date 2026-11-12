"use client";

import type { ReactNode } from "react";
import type { UpdatePreferences } from "../../actions/update-preferences";
import { PREFERENCE_MACHINE_SKINS, type PreferenceMachineSkin } from "../../schema";
import { SegmentedSection } from "./segmented-choice";
import type { StatusLabels } from "./status-line";
import type { SaveStatus } from "./use-preference-save";
import styles from "./settings.module.css";

/** One static machine per skin, drawn by the route (`TypingMachine` of the race feature, #558). */
export type MachineSpecimens = Partial<Record<PreferenceMachineSkin, ReactNode>>;

/**
 * Machine (#638, bible 7.1, 7.4, 7.7a): the 7.1 segmented toggle, one segment per registered skin, over a
 * static `TypingMachine` of the shown skin on the paper backdrop (no key state, nothing moves). Choosing a
 * skin files it and the specimen switches at once; the seat view draws the filed skin. The specimens come
 * from the route as rendered nodes: identity never imports the race feature's components (the race
 * feature reads identity's layouts, so the import would be a cycle).
 */
export function MachinePicker(props: {
  value: PreferenceMachineSkin;
  title: string;
  hint: string;
  names: Record<PreferenceMachineSkin, string>;
  status: StatusLabels;
  action: UpdatePreferences;
  initialStatus?: SaveStatus;
  specimens?: MachineSpecimens;
}) {
  return (
    <SegmentedSection<PreferenceMachineSkin>
      name="machineSkin"
      title={props.title}
      hint={props.hint}
      options={PREFERENCE_MACHINE_SKINS.map((skin) => ({ value: skin, label: props.names[skin] }))}
      value={props.value}
      toPatch={(machineSkin) => ({ machineSkin })}
      action={props.action}
      status={props.status}
      initialStatus={props.initialStatus}
      specimen={(skin) =>
        props.specimens?.[skin] ? (
          <div className={styles.machinePlate} data-machine-specimen={skin}>
            <div>{props.specimens[skin]}</div>
          </div>
        ) : null
      }
    />
  );
}
