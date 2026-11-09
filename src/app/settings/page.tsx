import { env } from "@/env";
import {
  getAvatarUser,
  getPreferences,
  getViewer,
  SettingsScreen,
  updatePreferences,
  uploadAvatar,
} from "@/features/identity";
import { LandingHeader } from "@/features/landing";

/**
 * `/settings` (#66, ADR 0009): the site header and the settings screen for the current viewer. proxy.ts
 * lets a session or a guest through; a visitor whose guest cookie no longer resolves reads the defaults
 * and gets a new guest on the first save (`updatePreferences`). A viewer on file gets the picture
 * dialog (#60); `?dialog=avatar` opens it on arrival outside production (eyes, #60 C9).
 */
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const [viewer, query] = await Promise.all([getViewer(), searchParams]);
  const [preferences, avatarUser] = await Promise.all([
    getPreferences(viewer),
    viewer ? getAvatarUser(viewer) : null,
  ]);
  const open = env.NODE_ENV !== "production" && query.dialog === "avatar";
  return (
    <>
      <LandingHeader />
      <main className="flex flex-1 flex-col">
        <SettingsScreen
          viewer={viewer}
          preferences={preferences}
          action={updatePreferences}
          avatar={avatarUser ? { user: avatarUser, action: uploadAvatar, open } : undefined}
        />
      </main>
    </>
  );
}
