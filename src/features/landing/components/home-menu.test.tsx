import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { HomeMenu, type HomeEntry, type HomeMenuProps, runEntryAction } from "./home-menu";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// #943 C2, C4, C29: the menu leaf's markup (server render) and the PLAY / PRACTICE outcome.
const errors = en.landing.errors;

function entries(t: typeof en, tag?: string): HomeEntry[] {
  const e = t.home.entries;
  const action = async () => ({ ok: true as const, code: "KGB-4821" });
  return [
    { id: "play", ...e.play, activate: { action, pendingLabel: t.home.pending.play } },
    { id: "practice", ...e.practice, activate: { action, pendingLabel: t.home.pending.practice } },
    { id: "rooms", ...e.rooms, activate: { href: "/welcome#rooms" } },
    { id: "file", ...e.file, activate: { href: "/profile" } },
    { id: "clerk", ...e.clerk, tag, activate: { href: "/locker" } },
    { id: "settings", ...e.settings, activate: { href: "/settings" } },
  ];
}

const props = (t: typeof en, over: Partial<HomeMenuProps> = {}): HomeMenuProps => ({
  entries: entries(t, "2 NEW"),
  labels: { menuLabel: t.home.menuLabel, keys: t.home.keys, errors: t.landing.errors },
  signOut: async () => {},
  signInHref: "/sign-in",
  version: "v0.1.0",
  ...over,
});

const render = (p: HomeMenuProps) => renderToStaticMarkup(<HomeMenu {...p} />);

describe("HomeMenu markup", () => {
  it("C2 six entries in order; one roving tab stop, the first selected", () => {
    const html = render(props(en));
    const ids = [...html.matchAll(/data-entry="([a-z]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["play", "practice", "rooms", "file", "clerk", "settings"]);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(/tabindex="0"[^>]*data-selected="true"[^>]*data-entry="play"/);
  });

  it("C10 the French entries read as the catalog says", () => {
    const html = render(props(fr as typeof en));
    for (const label of [
      "JOUER",
      "ENTRAÎNEMENT",
      "SALLES OUVERTES",
      "MON DOSSIER",
      "MON COMMIS",
      "RÉGLAGES",
    ]) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it("C4 the description line is a polite live region holding the selected entry's line", () => {
    const html = render(props(en));
    expect(html).toMatch(
      new RegExp(`aria-live="polite"[^>]*>${en.home.entries.play.description}<`),
    );
  });

  it("C4 descriptions are static: no digits (no queue or player counts) in either language", () => {
    for (const t of [en, fr])
      for (const e of Object.values(t.home.entries)) expect(e.description).not.toMatch(/\d/);
  });

  it("C2 an entry pending reads its pending label, busy; an error shows the 7.4 inline error line", () => {
    const html = render(props(en, { specimen: { pending: "play", error: errors.unavailable } }));
    expect(html).toContain(`>${en.home.pending.play}<`);
    expect(html).toMatch(/aria-busy="true"[^>]*data-pending="true"/);
    expect(html).toMatch(
      new RegExp(`role="alert"[^>]*><span[^>]*>${errors.prefix}</span> ${errors.unavailable}`),
    );
  });

  it("C29 the MY CLERK tag sits inside the entry (its accessible name) and nowhere else", () => {
    const html = render(props(en));
    expect(html).toMatch(/data-entry="clerk"[^>]*>.*MY CLERK<\/span><span[^>]*>2 NEW<\/span><\/a>/);
    expect(html.match(/2 NEW/g)).toHaveLength(1);
    expect(render(props(en, { entries: entries(en) }))).not.toContain("NEW");
  });

  it("C6 an account gets the ESC SIGN OUT button (a form); a guest a SIGN IN link and no ESC", () => {
    const account = render(props(en));
    expect(account).toMatch(/<form[^>]*><button type="submit"[^>]*data-sign-out/);
    expect(account).toContain(">ESC<");
    const guest = render(props(en, { signOut: null }));
    expect(guest).toMatch(/<a href="\/sign-in"[^>]*data-sign-in[^>]*>SIGN IN<\/a>/);
    expect(guest).not.toContain(">ESC<");
    expect(guest).not.toContain("data-sign-out");
  });

  it("C13 the leaf is the only client module of the screen", () => {
    const read = (f: string) => readFileSync(path.join(__dirname, f), "utf8");
    expect(read("home-menu.tsx")).toMatch(/^"use client";/);
    for (const f of [
      "home-screen.tsx",
      "mission-docket.tsx",
      "online-count.tsx",
      "player-docket.tsx",
    ]) {
      expect(read(f), f).not.toContain('"use client"');
    }
  });
});

describe("runEntryAction (C2)", () => {
  it("a seat lands on /lobby/<code>", async () => {
    await expect(
      runEntryAction(async () => ({ ok: true, code: "KGB-4821" }), errors),
    ).resolves.toEqual({
      href: "/lobby/KGB-4821",
    });
  });

  it.each([
    ["race-server-unavailable", errors.unavailable],
    ["rate-limited", errors.generic],
    ["invalid-settings", errors.generic],
  ])("%s shows its error line", async (error, line) => {
    await expect(runEntryAction(async () => ({ ok: false, error }), errors)).resolves.toEqual({
      error: line,
    });
  });

  it("a thrown action shows the generic line", async () => {
    await expect(
      runEntryAction(async () => {
        throw new Error("boom");
      }, errors),
    ).resolves.toEqual({ error: errors.generic });
  });
});
