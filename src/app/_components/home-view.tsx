import { cache } from "react";
import {
  Avatar,
  getAvatarUser,
  getClerkOutfit,
  getLockerUnseen,
  signOut,
  type Viewer,
} from "@/features/identity";
import {
  clerkEmbedSrc,
  HomeScreen,
  type HomeEntry,
  HomeStage,
  LINKS,
  MissionDocket,
  OnlineCount,
  PlayerDocket,
  StarCell,
} from "@/features/landing";
import { createPracticeLobby, quickRace } from "@/features/lobby";
import { countTypistsOnline } from "@/features/lobby/server";
import { getMissions, getProfile } from "@/features/stats";
import { fill, getT } from "@/i18n";
import pkg from "../../../package.json";
import { docketRank } from "./docket-rank";

/** One read of the viewer's missions per request: the mission docket and the star cell share it. */
const missionsOf = cache((id: string) => getMissions({ id }));

/**
 * The Home menu for a viewer (#943, #945, #946): the entries as data, the streamed parts as loaders
 * (ADR 0021: a landing component never imports a feature's server entry, so the route passes them).
 */
export async function HomeView({ viewer }: { viewer: Viewer }) {
  const [t, outfit, avatar, unseen] = await Promise.all([
    getT(),
    getClerkOutfit(viewer.id),
    getAvatarUser(viewer),
    getLockerUnseen(),
  ]);
  const h = t.home;
  const e = h.entries;
  const tag =
    unseen.length > 0
      ? fill(unseen.length === 1 ? h.tag.one : h.tag.other, { n: unseen.length })
      : undefined;
  const entries: HomeEntry[] = [
    { id: "play", ...e.play, activate: { action: quickRace, pendingLabel: h.pending.play } },
    {
      id: "practice",
      ...e.practice,
      activate: { action: createPracticeLobby, pendingLabel: h.pending.practice },
    },
    { id: "rooms", ...e.rooms, activate: { href: LINKS.rooms } },
    { id: "file", ...e.file, activate: { href: LINKS.profile } },
    { id: "clerk", ...e.clerk, tag, activate: { href: LINKS.locker ?? "/locker" } },
    { id: "settings", ...e.settings, activate: { href: "/settings" } },
  ];
  const missions = () => missionsOf(viewer.id);
  return (
    <HomeScreen
      title={t.brand.name}
      band={h.band}
      menu={{
        entries,
        labels: { menuLabel: h.menuLabel, keys: h.keys, errors: t.landing.errors },
        signOut: viewer.isGuest ? null : signOut,
        signInHref: LINKS.signIn,
        version: fill(h.version, { version: pkg.version }),
        online: <OnlineCount load={() => countTypistsOnline()} labels={h} />,
        mission: <MissionDocket load={missions} labels={h.mission} />,
      }}
      docket={
        <PlayerDocket
          player={{
            name: viewer.name,
            guest: viewer.isGuest,
            picture: <Avatar user={avatar} size={64} decorative />,
          }}
          href={LINKS.profile}
          labels={h.docket}
          load={async () =>
            docketRank((await getProfile(viewer)).service.meanWpm, t.landing.clerk.ranks)
          }
          stars={
            <StarCell
              load={async () => (await missions())?.stars ?? null}
              labels={h.docket.stars}
            />
          }
        />
      }
      stage={
        <HomeStage
          clerkSrc={clerkEmbedSrc(outfit)}
          title={h.stageTitle}
          picture={<Avatar user={avatar} size={128} decorative />}
        />
      }
    />
  );
}
