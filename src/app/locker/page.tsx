import { EmptyState } from "@/components/ui";
import {
  AUTH_LINKS,
  Avatar,
  getAvatarUser,
  getClerkOutfit,
  getLockerUnseen,
  getViewer,
  LockerScreen,
  markLockerSeen,
  saveClerkOutfit,
} from "@/features/identity";
import { clerkEmbedSrc, LandingHeader } from "@/features/landing";
import { getT } from "@/i18n";

/**
 * `/locker` (#943 part D, bible 14.2): the viewer's locker under the site header. proxy.ts lets a session
 * or a guest cookie through (the `/profile` pattern); the page reads only through `getViewer()` and
 * creates no guest: a cookie that no longer resolves gets the sign-in link. Saving goes through
 * `saveClerkOutfit` (zod, authorized inside); opening marks the NEW items seen (`markLockerSeen`).
 */
export default async function LockerPage() {
  const [viewer, t] = await Promise.all([getViewer(), getT()]);
  const l = t.locker;
  const [outfit, avatar, unseen] = viewer
    ? await Promise.all([getClerkOutfit(viewer.id), getAvatarUser(viewer), getLockerUnseen()])
    : [null, null, []];
  return (
    <>
      <LandingHeader />
      <LockerScreen
        form={
          viewer && avatar
            ? {
                labels: {
                  ...l,
                  categories: t.landing.clerk.categories,
                  items: t.landing.clerk.items,
                },
                name: viewer.name,
                saved: outfit,
                clerkSrc: clerkEmbedSrc(outfit, { locker: true }),
                picture: <Avatar user={avatar} size={128} decorative />,
                unseen,
                save: saveClerkOutfit,
                markSeen: markLockerSeen,
              }
            : null
        }
        signedOut={
          <div className="mx-auto w-full max-w-xl p-8">
            <EmptyState
              title={l.signedOut.title}
              description={l.signedOut.body}
              action={
                <a href={`${AUTH_LINKS.signIn}?callbackUrl=/locker`} className="underline">
                  {l.signedOut.cta}
                </a>
              }
            />
          </div>
        }
      />
    </>
  );
}
