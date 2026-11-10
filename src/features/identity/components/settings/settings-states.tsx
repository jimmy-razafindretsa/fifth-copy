import type { Viewer } from "@/server/auth";
import type { UpdatePreferences } from "../../actions/update-preferences";
import type { Preferences } from "../../schema";
import { SettingsDocket } from "./settings-screen";
import styles from "./settings.module.css";

const GUEST: Viewer = { id: "specimen-guest", name: "Lynx-101", isGuest: true, hasAvatar: false };
const ACCOUNT: Viewer = {
  id: "specimen-account",
  name: "comrade_lynx",
  isGuest: false,
  hasAvatar: false,
};
const DEFAULTS: Preferences = {
  layout: null,
  theme: "SYSTEM",
  locale: "en",
  sound: true,
  machineSkin: "teleprinter",
};
const CHOSEN: Preferences = {
  layout: "CSA",
  theme: "LIGHT",
  locale: "en",
  sound: false,
  machineSkin: "teleprinter",
};

/**
 * The `/design` settings states (#66 C7): the guest docket, the account docket, and the controls
 * pending, saved and refused. Each specimen carries `data-settings-state`; `action` is the design page's
 * own no-op save, so a click there files nothing.
 */
export function SettingsStates({ action }: { action: UpdatePreferences }) {
  const specimens = [
    { id: "guest", viewer: GUEST, preferences: DEFAULTS, initialStatus: {} },
    { id: "account", viewer: ACCOUNT, preferences: CHOSEN, initialStatus: {} },
    {
      id: "pending",
      viewer: GUEST,
      preferences: CHOSEN,
      initialStatus: { layout: "pending", theme: "pending" },
    },
    {
      id: "saved",
      viewer: GUEST,
      preferences: CHOSEN,
      initialStatus: { layout: "saved", sound: "saved" },
    },
    {
      id: "error",
      viewer: GUEST,
      preferences: CHOSEN,
      initialStatus: { layout: "error", language: "error" },
    },
  ] as const;
  return (
    <div className="flex flex-col gap-6">
      {specimens.map((s) => (
        <figure key={s.id} data-settings-state={s.id} className="m-0 flex flex-col gap-2">
          <figcaption className={styles.status}>{s.id.toUpperCase()}</figcaption>
          <SettingsDocket
            viewer={s.viewer}
            preferences={s.preferences}
            action={action}
            initialStatus={s.initialStatus}
            idPrefix={`settings-${s.id}`}
          />
        </figure>
      ))}
    </div>
  );
}
