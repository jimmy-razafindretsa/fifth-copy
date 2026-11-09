import { getPreferences, getViewer, SettingsScreen, updatePreferences } from "@/features/identity";
import { LandingHeader } from "@/features/landing";

/**
 * `/settings` (#66, ADR 0009): the site header and the settings screen for the current viewer. proxy.ts
 * lets a session or a guest through; a visitor whose guest cookie no longer resolves reads the defaults
 * and gets a new guest on the first save (`updatePreferences`).
 */
export default async function SettingsPage() {
  const viewer = await getViewer();
  const preferences = await getPreferences(viewer);
  return (
    <>
      <LandingHeader />
      <main className="flex flex-1 flex-col">
        <SettingsScreen viewer={viewer} preferences={preferences} action={updatePreferences} />
      </main>
    </>
  );
}
