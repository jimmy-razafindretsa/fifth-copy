import { useState, useSyncExternalStore, useTransition } from "react";
import type { UpdatePreferences } from "../../actions/update-preferences";
import type { PreferencesPatch } from "../../schema";

const noSubscribe = () => () => {};

/** A control's save state (#66 UI): idle, pending (on its way), saved (FILED) or error (RETURNED). */
export type SaveStatus = "idle" | "pending" | "saved" | "error";

/**
 * One settings control's value and save (#66): the choice shows at once, `apply` puts it on the page
 * (theme, language), the action files it; a refusal or a failure puts the last filed value back and
 * shows the error line. `hydrated` gates the e2e (a radio clicked before hydration does not save).
 */
export function usePreferenceSave<T>(
  initial: T,
  action: UpdatePreferences,
  initialStatus: SaveStatus = "idle",
  apply?: (value: T) => void,
) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>(initialStatus);
  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const [, startTransition] = useTransition();

  const save = (next: T, patch: PreferencesPatch) => {
    if (next === value) return;
    const previous = value;
    const revert = () => {
      setValue(previous);
      apply?.(previous);
      setStatus("error");
    };
    setValue(next);
    apply?.(next);
    setStatus("pending");
    startTransition(async () => {
      try {
        const result = await action(patch);
        if (result.ok) setStatus("saved");
        else revert();
      } catch {
        revert();
      }
    });
  };

  return { value, status, save, hydrated };
}
