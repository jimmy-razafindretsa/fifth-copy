import {
  AUTH_LINKS,
  Avatar,
  DefaultPortrait,
  getAvatarUser,
  getClerkOutfit,
  getPreferences,
  getServiceStart,
  getViewer,
  keyboardLayoutIds,
  layouts,
  localeLayouts,
  numberRows,
} from "@/features/identity";
import { clerkEmbedSrc, LINKS } from "@/features/landing";
import { createPracticeLobby } from "@/features/lobby";
import { SiteHeader } from "@/app/_components/site-header";
import {
  getCallouts,
  getCensus,
  getKeyFile,
  getMedals,
  getPersonalBests,
  getProfile,
  ProfileScreen,
  profileLabels,
} from "@/features/stats";
import { getLocale, getT } from "@/i18n";

/**
 * `/profile` (#932, ADR 0009): the viewer's own Personnel file under the site header. proxy.ts lets a
 * session or a guest cookie through; the page reads only through `getViewer()` and the viewer's own id,
 * and creates no guest: a cookie that no longer resolves shows the blank file, unassigned. The typist
 * census (#967, ADR 0023) streams in its own `Suspense` slot inside the file; the key file (#961) feeds
 * the progress by key (#962). The keyboard map (#324) draws it on identity's layouts, starting on the
 * viewer's saved layout, else the locale's default (as the race machine does); the attendance register
 * shades each day against the viewer's daily goal (#968). The enamel pins (#999 C36) read the viewer's
 * own awards; the personal bests (#999 C43) the viewer's own stored bests; the weekly callouts (#999
 * C48) the viewer's own daily key rows. "Practise this letter" (#999 C47) is lobby's practice action,
 * handed to the key sheet (stats never imports lobby).
 */
export default async function ProfilePage() {
  const [viewer, t, locale] = await Promise.all([getViewer(), getT(), getLocale()]);
  // the register reads the viewer's daily goal (#968) from the preference read the page already makes
  const preferencesRead = getPreferences(viewer);
  const [profile, keyFile, preferences, since, outfit, avatar, medals, bests, callouts] =
    await Promise.all([
      getProfile(viewer, { goalMin: preferencesRead.then((p) => p.dailyGoalMin) }),
      getKeyFile(viewer),
      preferencesRead,
      viewer ? getServiceStart(viewer.id) : null,
      viewer ? getClerkOutfit(viewer.id) : null,
      viewer ? getAvatarUser(viewer) : null,
      getMedals(viewer),
      viewer ? getPersonalBests(viewer) : null,
      getCallouts(viewer),
    ]);
  const picture = avatar ? (
    <Avatar user={avatar} size={128} decorative />
  ) : (
    <DefaultPortrait seed="unassigned" size={128} />
  );
  return (
    <>
      <SiteHeader current="profile" />
      <main className="flex flex-1 flex-col">
        <ProfileScreen
          profile={profile}
          viewer={viewer}
          since={since}
          stage={{ clerkSrc: outfit ? clerkEmbedSrc(outfit) : null, picture }}
          labels={profileLabels(t)}
          locale={locale}
          links={{ play: `/${LINKS.play}`, settings: "/settings", signUp: AUTH_LINKS.signUp }}
          census={viewer ? () => getCensus(viewer) : undefined}
          keyFile={keyFile}
          medals={medals}
          bests={bests}
          callouts={callouts}
          practise={createPracticeLobby}
          keyboard={{
            initial: preferences.layout ?? localeLayouts[locale],
            layouts: keyboardLayoutIds.map((id) => ({
              id,
              keys: { number: numberRows[id], letters: layouts[id] },
            })),
          }}
        />
      </main>
    </>
  );
}
