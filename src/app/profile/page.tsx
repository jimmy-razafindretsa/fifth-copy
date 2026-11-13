import {
  AUTH_LINKS,
  Avatar,
  DefaultPortrait,
  getAvatarUser,
  getClerkOutfit,
  getServiceStart,
  getViewer,
} from "@/features/identity";
import { clerkEmbedSrc, LandingHeader, LINKS } from "@/features/landing";
import { getProfile, ProfileScreen, profileLabels } from "@/features/stats";
import { getLocale, getT } from "@/i18n";

/**
 * `/profile` (#932, ADR 0009): the viewer's own Personnel file under the site header. proxy.ts lets a
 * session or a guest cookie through; the page reads only through `getViewer()` and the viewer's own id,
 * and creates no guest: a cookie that no longer resolves shows the blank file, unassigned.
 */
export default async function ProfilePage() {
  const [viewer, t, locale] = await Promise.all([getViewer(), getT(), getLocale()]);
  const [profile, since, outfit, avatar] = await Promise.all([
    getProfile(viewer),
    viewer ? getServiceStart(viewer.id) : null,
    viewer ? getClerkOutfit(viewer.id) : null,
    viewer ? getAvatarUser(viewer) : null,
  ]);
  const picture = avatar ? (
    <Avatar user={avatar} size={128} decorative />
  ) : (
    <DefaultPortrait seed="unassigned" size={128} />
  );
  return (
    <>
      <LandingHeader current="profile" />
      <main className="flex flex-1 flex-col">
        <ProfileScreen
          profile={profile}
          viewer={viewer}
          since={since}
          stage={{ clerkSrc: outfit ? clerkEmbedSrc(outfit) : null, picture }}
          labels={profileLabels(t)}
          locale={locale}
          links={{ play: `/${LINKS.play}`, settings: "/settings", signUp: AUTH_LINKS.signUp }}
        />
      </main>
    </>
  );
}
