"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SoundController } from "../client/audio/start";
import { useRaceStoreApi } from "../client/use-race-store";
import { SoundToggle } from "../components/sound-toggle";
import type { SoundLabels } from "../view/hud-labels";

/** The identity feature's preference save (`updatePreferences`), passed down by the route. */
export type SaveSound = (patch: { sound: boolean }) => Promise<{ ok: boolean }>;

/**
 * The sound toggle over the store (#243 C4): it starts from the viewer's filed `sound` (`getPreferences`,
 * muted by default), applies a choice at once and files it through `updatePreferences({ sound })`; a
 * refused or failed save puts the last value back. The audio module (`client/audio/start.ts`: the engine,
 * the store bindings, the sound files) is `import()`ed on the first unmute only, never while muted (ADR
 * 0013: no audio in the race route's first load); muting again keeps it loaded and silent.
 */
export function SeatSound({
  initial,
  save,
  labels,
}: {
  initial: boolean;
  save: SaveSound;
  labels: SoundLabels;
}) {
  const store = useRaceStoreApi();
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState(false);
  const sounds = useRef<Promise<SoundController> | null>(null);

  useEffect(() => {
    if (!on) {
      void sounds.current?.then((c) => c.setMuted(true));
      return;
    }
    sounds.current ??= import("../client/audio/start").then((m) => m.startSounds(store));
    void sounds.current.then((c) => c.setMuted(false));
  }, [on, store]);
  useEffect(
    () => () => {
      const loaded = sounds.current;
      sounds.current = null;
      void loaded?.then((c) => c.dispose());
    },
    [],
  );

  const choose = useCallback(
    async (next: boolean) => {
      setOn(next);
      setSaving(true);
      setRefused(false);
      const result = await save({ sound: next }).catch(() => null);
      setSaving(false);
      if (!result?.ok) {
        setOn(!next);
        setRefused(true);
      }
    },
    [save],
  );

  return (
    <SoundToggle
      on={on}
      saving={saving}
      refused={refused}
      onChoose={(next) => void choose(next)}
      labels={labels}
    />
  );
}
