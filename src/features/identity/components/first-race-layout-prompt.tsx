import { getT } from "@/i18n";
import { getViewer } from "@/server/auth";
import { updatePreferences } from "../actions/update-preferences";
import { getPreferences } from "../queries/get-preferences";
import { LayoutPrompt } from "./layout-prompt";

/**
 * The lobby's mount of the keyboard prompt (#70): renders it only while the viewer has no layout on
 * file (`getPreferences(viewer).layout === null`), with the real save.
 */
export async function FirstRaceLayoutPrompt() {
  const viewer = await getViewer();
  const [preferences, t] = await Promise.all([getPreferences(viewer), getT()]);
  if (preferences.layout !== null) return null;
  return (
    <LayoutPrompt
      action={updatePreferences}
      labels={t.settings.layoutPrompt}
      names={t.settings.layout.names}
      status={t.settings.status}
    />
  );
}
