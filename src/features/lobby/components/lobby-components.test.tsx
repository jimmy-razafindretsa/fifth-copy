import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { deskIdentity, type Member } from "@fifth-copy/protocol";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { deskLabel, fill, playersLabel } from "./lobby-labels";
import { LobbyLiveView, type StartState } from "./lobby-live";
import { initialLobbyState, type LobbyState } from "./lobby-store";
import { PlayerList } from "./player-list";

// Contract of card 107, C6: every state renders, every string from the catalog (C6 greps `src`).
vi.mock("../actions/mint-race-token", () => ({ mintRaceToken: vi.fn() }));

const labels = en.lobby;
const errors = en.landing.errors;
const CODE = "KGB-4821";

const member = (desk: number, isHost = false): Member => ({
  desk,
  name: `Clerk-${desk}`,
  isHost,
  isBot: false,
  ...deskIdentity(desk),
});
const live = (members: Member[], you = 1): LobbyState => ({
  phase: "live",
  error: null,
  you,
  members,
  raceId: null,
});
const view = (state: LobbyState) =>
  renderToStaticMarkup(<LobbyLiveView code={CODE} state={state} labels={labels} errors={errors} />);
const rows = (html: string) => html.match(/<li[ >]/g)?.length ?? 0;

describe("labels", () => {
  it("fills templates from the catalog", () => {
    expect(fill(labels.typistsValue, { n: 2, max: 30 })).toBe("2 / 30");
    expect(deskLabel(labels, 5)).toBe("DESK 05");
    expect(deskLabel(labels, 30)).toBe("DESK 30");
    expect(playersLabel(labels, 1)).toBe(fill(labels.players.one, { n: 1 }));
    expect(playersLabel(labels, 2)).toBe(fill(labels.players.other, { n: 2 }));
  });
});

describe("LobbyLiveView states", () => {
  it("loading: skeleton rows in an aria-busy list, the docket without a count", () => {
    const html = view(initialLobbyState);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(labels.loading);
    expect(html).toContain(`aria-label="${labels.listName}"`);
    expect(rows(html)).toBe(3);
    expect(html).not.toContain(labels.host);
    expect(html).toContain(`aria-label="${labels.codeName}"`);
    expect(html).toContain(CODE);
    expect(html).toContain(fill(labels.typistsValue, { n: "—", max: 30 }));
    expect(html).not.toContain('role="alert"');
  });

  it("populated with one row: HOST and YOU on the viewer's row, the count announced", () => {
    const html = view(live([member(1, true)]));
    expect(html).not.toContain("aria-busy");
    expect(rows(html)).toBe(1);
    expect(html).toContain(deskLabel(labels, 1));
    expect(html).toContain(`>${labels.host}<`);
    expect(html).toContain(`>${labels.you}<`);
    expect(html).toContain(fill(labels.typistsValue, { n: 1, max: 30 }));
    expect(html).toMatch(new RegExp(`aria-live="polite"[^>]*>${playersLabel(labels, 1)}<`));
  });

  it("populated with two rows: YOU follows the viewer's desk, HOST the host", () => {
    const html = view(live([member(1, true), member(2)], 2));
    expect(rows(html)).toBe(2);
    const [first, second] = html.split("<li").slice(1);
    expect(first).toContain(labels.host);
    expect(first).not.toContain(`>${labels.you}<`);
    expect(second).toContain(`>${labels.you}<`);
    expect(second).not.toContain(labels.host);
    expect(html).toContain(playersLabel(labels, 2));
    expect(html).toContain(fill(labels.typistsValue, { n: 2, max: 30 }));
  });

  it("populated with thirty rows, desks 01 to 30, in a focusable list", () => {
    const members = Array.from({ length: 30 }, (_, i) => member(i + 1, i === 0));
    const html = view(live(members));
    expect(rows(html)).toBe(30);
    expect(html).toContain(deskLabel(labels, 30));
    expect(html).toContain('tabindex="0"');
    expect(html).toContain(fill(labels.typistsValue, { n: 30, max: 30 }));
  });

  it.each([
    ["closed", errors.closed],
    ["not-found", errors.notFound],
    ["generic", errors.generic],
  ] as const)("error %s: an InlineError line, no list", (error, message) => {
    const html = view({ ...initialLobbyState, phase: "error", error });
    expect(html).toContain('role="alert"');
    expect(html).toContain(errors.prefix);
    expect(html).toContain(message);
    expect(rows(html)).toBe(0);
    expect(html).not.toContain("aria-busy");
  });

  it("reconnecting: the notice row above the last known list", () => {
    const html = view({ ...live([member(1, true), member(2)]), phase: "reconnecting" });
    expect(html).toContain(labels.reconnecting);
    expect(html).toMatch(/role="status"/);
    expect(html.indexOf(labels.reconnecting)).toBeLessThan(html.indexOf("<ul"));
    expect(rows(html)).toBe(2);
  });
});

// Contract of #214 C8: the host's START (bible 7.1 primary stamp button) under the roll. Only the host
// sees it; it is disabled with the line TWO TYPISTS NEEDED below two seated typists and enabled from
// two; each refusal of the ack renders as a 7.4 inline error line under it, and `not-host` hides it.
describe("START (#214 C8)", () => {
  const idle: StartState = { pending: false, error: null, hidden: false };
  const startView = (state: LobbyState, start: StartState = idle, l = labels) =>
    renderToStaticMarkup(
      <LobbyLiveView
        code={CODE}
        state={state}
        labels={l}
        errors={errors}
        start={start}
        onStart={() => {}}
      />,
    );
  const button = (html: string) => /<button[^>]*>[^<]*<\/button>/.exec(html)?.[0] ?? null;
  const host = member(1, true);
  const guest = member(2);

  it("the host alone: START disabled, the TWO TYPISTS NEEDED line describes it", () => {
    const html = startView(live([host], 1));
    const b = button(html)!;
    expect(b).toContain(`>${labels.start.button}<`);
    expect(b).toContain('disabled=""');
    expect(b).toContain('type="button"');
    expect(html).toContain(labels.start.needTwo);
    expect(labels.start.needTwo).toBe("TWO TYPISTS NEEDED");
    const describedBy = /aria-describedby="([^"]+)"/.exec(b)![1]!;
    expect(html).toMatch(new RegExp(`id="${describedBy}"[^>]*>${labels.start.needTwo}<`));
  });

  it("the host with two seated: START enabled, no line", () => {
    const html = startView(live([host, guest], 1));
    const b = button(html)!;
    expect(b).not.toContain("disabled");
    expect(b).not.toContain("aria-busy");
    expect(html).not.toContain(labels.start.needTwo);
  });

  it("bots count as seated typists", () => {
    const html = startView(live([host, { ...member(2), isBot: true }], 1));
    expect(button(html)).not.toContain("disabled");
  });

  it("a guest sees no START", () => {
    expect(button(startView(live([host, guest], 2)))).toBeNull();
    expect(startView(live([host, guest], 2))).not.toContain(labels.start.needTwo);
  });

  it("no START before the welcome, on an error or while reconnecting", () => {
    expect(button(startView(initialLobbyState))).toBeNull();
    expect(
      button(startView({ ...initialLobbyState, phase: "error", error: "generic" })),
    ).toBeNull();
    expect(button(startView({ ...live([host, guest], 1), phase: "reconnecting" }))).toBeNull();
  });

  it("pending: STARTING…, disabled and busy; the starting phase keeps it so", () => {
    for (const html of [
      startView(live([host, guest], 1), { ...idle, pending: true }),
      startView({ ...live([host, guest], 1), phase: "starting", raceId: "r" }),
    ]) {
      const b = button(html)!;
      expect(b).toContain(`>${labels.start.pending}<`);
      expect(b).toContain('disabled=""');
      expect(b).toContain('aria-busy="true"');
    }
  });

  it.each(["too-few", "not-waiting", "start-failed", "timeout"] as const)(
    "the %s ack: a 7.4 inline line under the button",
    (error) => {
      const html = startView(live([host, guest], 1), { ...idle, error });
      const line = new RegExp(
        `<p id="([^"]+)" role="alert"[^>]*><span[^>]*>${errors.prefix}</span> ${labels.start.errors[error].replace(".", "\\.")}</p>`,
      );
      expect(html).toMatch(line);
      expect(html.indexOf("<button")).toBeLessThan(html.search(line));
      const b = button(html)!;
      expect(b).toContain(`aria-describedby="${line.exec(html)![1]}"`);
    },
  );

  it("the not-host ack hides it", () => {
    const html = startView(live([host, guest], 1), { ...idle, hidden: true });
    expect(button(html)).toBeNull();
  });

  it("French: DÉMARRER and IL FAUT DEUX DACTYLOS, nothing English", () => {
    const html = startView(live([member(1, true)], 1), idle, fr.lobby);
    expect(button(html)).toContain(">DÉMARRER<");
    expect(html).toContain("IL FAUT DEUX DACTYLOS");
    expect(html).not.toContain("START<");
    expect(html).not.toContain("TWO TYPISTS");
  });

  it("the catalogs carry every lobby.start string in both languages", () => {
    expect(Object.keys(fr.lobby.start.errors).sort()).toEqual(
      Object.keys(en.lobby.start.errors).sort(),
    );
    expect(Object.keys(en.lobby.start.errors).sort()).toEqual(
      ["not-waiting", "start-failed", "timeout", "too-few"].sort(),
    );
  });
});

// Contract of #105 C1: a bot's row carries the ink BOT tag (the YOU tag recipe) after its name; a human
// none; a bot never gets YOU or HOST.
describe("BOT tag (#105 C1)", () => {
  const bot = (desk: number): Member => ({ ...member(desk), name: `Agent ${desk}`, isBot: true });
  const tag = (text: string) => new RegExp(`<span class="_tag_[^"]*">${text}</span>`);

  it("a bot row: the BOT tag after the name, in the YOU tag's class", () => {
    const html = view(live([member(1, true), bot(2)], 1));
    const [first, second] = html.split("<li").slice(1);
    expect(second).toMatch(tag(labels.bot));
    expect(second!.indexOf("Agent 2")).toBeLessThan(second!.indexOf(`>${labels.bot}<`));
    expect(first).not.toContain(`>${labels.bot}<`);
    expect(labels.bot).toBe("BOT");
  });

  it("a bot never gets YOU or HOST, even with the flags on its member", () => {
    const html = renderToStaticMarkup(
      <PlayerList members={[{ ...bot(4), isHost: true }]} you={4} labels={labels} />,
    );
    expect(html).toContain(`>${labels.bot}<`);
    expect(html).not.toContain(`>${labels.you}<`);
    expect(html).not.toContain(labels.host);
  });

  it("several bots, each tagged; no bots, no tag", () => {
    expect(view(live([member(1, true), bot(2), bot(3)])).match(/>BOT</g)).toHaveLength(2);
    expect(view(live([member(1, true), member(2)]))).not.toContain(`>${labels.bot}<`);
  });

  it("French: the tag stays BOT (language-neutral, as the Dawn report's)", () => {
    expect(fr.lobby.bot).toBe("BOT");
  });
});

// Contract of #105 C2: a non-host sees the 7.4 notice row WAITING FOR THE HOST (role status, no pulse)
// at the top of the roll and no START; the host sees START and no notice; absent while loading, in error
// and once the phase is starting.
describe("non-host notice row (#105 C2)", () => {
  const host = member(1, true);
  const guest = member(2);
  const waiting = (html: string) => html.includes(`>${labels.waitingForHost}<`);

  it("the guest: one status row WAITING FOR THE HOST above the list, no pulse, no START", () => {
    const html = view(live([host, guest], 2));
    expect(html.match(new RegExp(`>${labels.waitingForHost}<`, "g"))).toHaveLength(1);
    expect(html).toMatch(
      new RegExp(`<p role="status" class="[^"]*"[^>]*>${labels.waitingForHost}<`),
    );
    const cls = new RegExp(`<p role="status" class="([^"]*)"[^>]*>${labels.waitingForHost}<`).exec(
      html,
    )![1]!;
    expect(cls).toMatch(/_notice_/);
    expect(cls).not.toMatch(/_pulse_/);
    expect(html.indexOf(labels.waitingForHost)).toBeLessThan(html.indexOf("<ul"));
    expect(html).not.toContain("<button");
    expect(labels.waitingForHost).toBe("WAITING FOR THE HOST");
  });

  it("the host: START and no notice", () => {
    const html = view(live([host, guest], 1));
    expect(html).toContain(`>${labels.start.button}<`);
    expect(waiting(html)).toBe(false);
  });

  it("absent while loading, in error and once starting", () => {
    expect(waiting(view(initialLobbyState))).toBe(false);
    expect(waiting(view({ ...initialLobbyState, phase: "error", error: "generic" }))).toBe(false);
    expect(waiting(view({ ...live([host, guest], 2), phase: "starting", raceId: "r" }))).toBe(
      false,
    );
  });

  it("a reconnecting guest: the pulsing reconnecting row above the notice", () => {
    const html = view({ ...live([host, guest], 2), phase: "reconnecting" });
    const statuses = [...html.matchAll(/<p role="status" class="([^"]*)"[^>]*>([^<]*)</g)];
    expect(statuses.map((m) => m[2])).toEqual([labels.reconnecting, labels.waitingForHost]);
    expect(statuses[0]![1]).toMatch(/_pulse_/);
    expect(statuses[1]![1]).not.toMatch(/_pulse_/);
  });

  it("French: EN ATTENTE DE L'HÔTE", () => {
    const html = renderToStaticMarkup(
      <LobbyLiveView
        code={CODE}
        state={live([host, guest], 2)}
        labels={fr.lobby}
        errors={errors}
      />,
    );
    expect(html).toContain("EN ATTENTE DE L&#x27;HÔTE");
    expect(html).not.toContain("WAITING FOR");
  });
});

describe("PlayerList slots", () => {
  it("renders leading before the name and tags after the badges", () => {
    const html = renderToStaticMarkup(
      <PlayerList
        members={[member(3, true)]}
        you={3}
        labels={labels}
        leading={() => <i>avatar</i>}
        tags={() => <b>extra</b>}
      />,
    );
    const order = ["<i>avatar</i>", "Clerk-3", labels.host, labels.you, "<b>extra</b>"].map((s) =>
      html.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

// Card 536 (ADR 0013, 250 kB first-load budget): the socket module pulls socket.io-client and the
// protocol schemas (zod, ~93 kB gzip) and must stay out of the lobby's first load. Lobby components
// may import its types; values are loaded with `import("@/features/race")` once the room connects.
describe("lobby client code keeps @/features/race out of the first load", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
  const staticImport = /import\s+([^;]*?)\s+from\s+["']@\/features\/race["']/g;
  const isTypeOnly = (clause: string) =>
    /^type\s/.test(clause) ||
    (/^\{[^}]*\}$/.test(clause) &&
      clause
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .every((s) => s.startsWith("type ")));

  it.each(sources)("%s has no static value import of @/features/race", (file) => {
    const text = readFileSync(path.join(dir, file), "utf8");
    const values = [...text.matchAll(staticImport)]
      .map((m) => m[1]!.trim())
      .filter((c) => !isTypeOnly(c));
    expect(values).toEqual([]);
  });

  it("lobby-live loads the race module lazily", () => {
    const text = readFileSync(path.join(dir, "lobby-live.tsx"), "utf8");
    expect(text).toMatch(/import\(\s*["']@\/features\/race["']\s*\)/);
  });
});
