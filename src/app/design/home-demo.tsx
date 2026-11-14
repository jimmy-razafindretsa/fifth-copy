import {
  DefaultPortrait,
  LockerForm,
  OUTFIT_CATALOGUE,
  type Outfit,
  saveClerkOutfit,
  signOut,
} from "@/features/identity";
import {
  HomeMenu,
  type HomeEntry,
  HomeStage,
  MissionDocketView,
  OnlineFigure,
  PlayerDocketView,
  StarCellView,
} from "@/features/landing";
import { createPracticeLobby, quickRace } from "@/features/lobby";
import { docketRank } from "../_components/docket-rank";
import { fill } from "@/i18n";
import type { Messages } from "@/i18n/en";

// `/design#home-menu` and `/design#locker` (#943, #945, #946): the Home menu and the locker as still
// specimens (no focus on load, no embed, no side effect until a control is pressed).

type Specimen = { id: string; title: string; caption: string; children: React.ReactNode };

function Figure({ id, title, caption, children }: Specimen) {
  return (
    <figure data-home-specimen={id} className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-col gap-1">
        <span className="type-label text-fg">{title}</span>
        <span className="type-body text-sm text-fg-muted">{caption}</span>
      </figcaption>
      {children}
    </figure>
  );
}

function entries(t: Messages, tag: boolean): HomeEntry[] {
  const e = t.home.entries;
  return [
    { id: "play", ...e.play, activate: { action: quickRace, pendingLabel: t.home.pending.play } },
    {
      id: "practice",
      ...e.practice,
      activate: { action: createPracticeLobby, pendingLabel: t.home.pending.practice },
    },
    { id: "rooms", ...e.rooms, activate: { href: "/welcome#rooms" } },
    { id: "file", ...e.file, activate: { href: "/profile" } },
    {
      id: "clerk",
      ...e.clerk,
      tag: tag ? fill(t.home.tag.other, { n: 2 }) : undefined,
      activate: { href: "/locker" },
    },
    { id: "settings", ...e.settings, activate: { href: "/settings" } },
  ];
}

const MISSIONS: {
  id: string;
  title: string;
  mission: "accuracy-95" | "finish-3" | "accuracy-98";
  target: number;
  progress: number;
}[] = [
  { id: "none", title: "Mission, 0 of 3", mission: "accuracy-95", target: 3, progress: 0 },
  { id: "partial", title: "Mission, 1 of 3", mission: "finish-3", target: 3, progress: 1 },
  { id: "complete", title: "Mission, complete", mission: "finish-3", target: 3, progress: 3 },
  { id: "target-1", title: "Mission, target 1", mission: "accuracy-98", target: 1, progress: 0 },
];

export function HomeSpecimens({ t }: { t: Messages }) {
  const labels = { menuLabel: t.home.menuLabel, keys: t.home.keys, errors: t.landing.errors };
  const menu = (id: string, over: Partial<Parameters<typeof HomeMenu>[0]> = {}) => (
    <div className="border-2 border-fg bg-bg p-4">
      <HomeMenu
        entries={entries(t, true)}
        labels={labels}
        signOut={signOut}
        signInHref="/sign-in"
        version="v0.1.0"
        online={<OnlineFigure online={214} labels={t.home} />}
        specimen={{}}
        {...over}
      />
      <span hidden data-specimen-id={id} />
    </div>
  );
  const docketLabels = t.home.docket;
  const ranks = t.landing.clerk.ranks;
  const portrait = <DefaultPortrait seed="Lynx-785" size={64} />;
  const stars = <StarCellView stars={23} labels={t.home.docket.stars} />;
  return (
    <div className="flex flex-col gap-6">
      <Figure
        id="account"
        title="Account"
        caption="ESC SIGN OUT in the key-hint bar; PLAY selected."
      >
        {menu("account")}
      </Figure>
      <Figure
        id="guest"
        title="Guest"
        caption="SIGN IN in place of the Escape hint; no figure online."
      >
        {menu("guest", { signOut: null, online: undefined })}
      </Figure>
      <Figure
        id="pending"
        title="Entry pending"
        caption="PLAY on its way: its pending words, busy."
      >
        {menu("pending", { specimen: { pending: "play" } })}
      </Figure>
      <Figure
        id="error"
        title="Entry error"
        caption="The 7.4 inline error line; the entry is enabled again."
      >
        {menu("error", { specimen: { error: t.landing.errors.unavailable } })}
      </Figure>
      <Figure
        id="no-tag"
        title="MY CLERK without its tag"
        caption="Every NEW item seen in the locker."
      >
        {menu("no-tag", { entries: entries(t, false) })}
      </Figure>
      <div className="grid gap-6 md:grid-cols-2">
        {MISSIONS.map((m) => (
          <Figure key={m.id} id={`mission-${m.id}`} title={m.title} caption="The mission docket.">
            <MissionDocketView
              idPrefix={`design-mission-${m.id}`}
              mission={{
                id: m.mission,
                target: m.target,
                progress: m.progress,
                complete: m.progress >= m.target,
              }}
              labels={t.home.mission}
            />
          </Figure>
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Figure
          id="docket-account"
          title="Player docket, account"
          caption="Officer at 51.4: 51 / 70 → COMMISSAR."
        >
          <PlayerDocketView
            player={{ name: "Lynx-785", picture: portrait, guest: false }}
            href="/profile"
            labels={docketLabels}
            rank={docketRank(51.4, ranks)}
            stars={stars}
          />
        </Figure>
        <Figure
          id="docket-top"
          title="Player docket, top rank"
          caption="HERO OF PAPERWORK: no bar, no line."
        >
          <PlayerDocketView
            player={{ name: "Lynx-785", picture: portrait, guest: false }}
            href="/profile"
            labels={docketLabels}
            rank={docketRank(96, ranks)}
            stars={stars}
          />
        </Figure>
        <Figure
          id="docket-guest"
          title="Player docket, guest"
          caption="The GUEST tag; no rank, bar or line."
        >
          <PlayerDocketView
            player={{
              name: "Heron-302",
              picture: <DefaultPortrait seed="Heron-302" size={64} />,
              guest: true,
            }}
            href="/profile"
            labels={docketLabels}
            rank={null}
            stars={<StarCellView stars={0} labels={t.home.docket.stars} />}
          />
        </Figure>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Figure
          id="stage-avatar"
          title="Stage, approved picture"
          caption="Still: the portrait on the podium."
        >
          <HomeStage
            clerkSrc={null}
            title={t.home.stageTitle}
            picture={<DefaultPortrait seed="Badger-126" size={128} />}
            still
          />
        </Figure>
        <Figure
          id="stage-default"
          title="Stage, default portrait"
          caption="Still: the stamped portrait."
        >
          <HomeStage
            clerkSrc={null}
            title={t.home.stageTitle}
            picture={<DefaultPortrait seed="unassigned" size={128} />}
            still
          />
        </Figure>
      </div>
    </div>
  );
}

export function LockerSpecimens({ t }: { t: Messages }) {
  const labels = {
    ...t.locker,
    categories: t.landing.clerk.categories,
    items: t.landing.clerk.items,
  };
  const saved: Outfit = {
    hair: "side",
    glasses: "square",
    hat: "none",
    clothes: "vest",
    face: "stache",
    hairCol: OUTFIT_CATALOGUE.hairCol[0],
  };
  const form = (id: string, dirty: boolean) => (
    <div className="border-2 border-fg">
      <LockerForm
        labels={labels}
        name="Lynx-785"
        saved={saved}
        clerkSrc="/3d/clerk.html?locker=1"
        picture={<DefaultPortrait seed="Lynx-785" size={128} />}
        unseen={["glasses:square", "hat:kepka"]}
        save={saveClerkOutfit}
        specimen={
          dirty ? { tab: "glasses", outfit: { ...saved, glasses: "round" } } : { tab: "glasses" }
        }
        idPrefix={`design-locker-${id}`}
        headingLevel={2}
      />
    </div>
  );
  return (
    <div className="flex flex-col gap-6">
      <Figure
        id="locker-clean"
        title="Locker, clean"
        caption="ON FILE; the equipped card (ISSUED), owned cards and a NEW card."
      >
        {form("clean", false)}
      </Figure>
      <Figure
        id="locker-dirty"
        title="Locker, dirty"
        caption="SIGN & FILE red and the UNSIGNED CHANGES bar."
      >
        {form("dirty", true)}
      </Figure>
    </div>
  );
}
