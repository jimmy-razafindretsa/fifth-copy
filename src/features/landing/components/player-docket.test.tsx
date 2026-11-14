import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import {
  type DocketRank,
  PlayerDocketLoaded,
  PlayerDocketView,
  StarCellLoaded,
  StarCellView,
} from "./player-docket";

// #945 C3, C5, C9 and #943 C19: the player docket and its star cell.
const labels = en.home.docket;
const RANKS: Record<string, DocketRank> = {
  officer: {
    level: "officer",
    name: "OFFICER",
    meanWpm: 51.4,
    next: { name: "COMMISSAR", at: 70, progress: 1.4 / 20 },
  },
  low: {
    level: "clerk",
    name: "CLERK",
    meanWpm: 40,
    next: { name: "OFFICER", at: 50, progress: 1 / 3 },
  },
  hero: { level: "major", name: "HERO OF PAPERWORK", meanWpm: 95, next: null },
};
const player = { name: "Lynx-785", picture: <svg />, guest: false };
const view = (rank: DocketRank | null, guest = false) =>
  renderToStaticMarkup(
    <PlayerDocketView player={{ ...player, guest }} href="/profile" labels={labels} rank={rank} />,
  );

describe("PlayerDocketView", () => {
  it("#945 C2 an officer at 51.4 reads OFFICER and 51 / 70 WPM → COMMISSAR", () => {
    const html = view(RANKS.officer!);
    expect(html).toContain(">OFFICER<");
    expect(html).toContain(">51 / 70 WPM → COMMISSAR<");
  });

  it("#945 C3 the top rank reads HERO OF PAPERWORK with no bar and no arrow line", () => {
    const html = view(RANKS.hero!);
    expect(html).toContain(">HERO OF PAPERWORK<");
    expect(html).not.toContain("progressbar");
    expect(html).not.toContain("→");
  });

  it("#945 C4 a guest shows GUEST and no rank, bar or line", () => {
    const html = view(null, true);
    expect(html).toContain(">GUEST<");
    expect(html).not.toContain("progressbar");
    expect(html).not.toContain("WPM");
  });

  it("#945 C5 the bar is a named progressbar; the portrait is decorative; the link names the player", () => {
    const html = view(RANKS.low!);
    expect(html).toMatch(
      /role="progressbar" aria-label="Progress to OFFICER" aria-valuemin="0" aria-valuemax="100" aria-valuenow="33"/,
    );
    expect(html).toMatch(/<a href="\/profile"[^>]*aria-label="My file, Lynx-785"/);
    expect(html).toMatch(/aria-hidden="true"><svg/);
  });

  it("#945 C9 a failing stats read renders no docket", async () => {
    const node = await PlayerDocketLoaded({
      player,
      href: "/profile",
      labels,
      load: () => Promise.reject(new Error("db down")),
    });
    expect(node).toBeNull();
  });
});

describe("StarCell (#943 C19)", () => {
  it.each([
    [0, "0 stars"],
    [1, "1 star"],
    [2, "2 stars"],
  ])("%i reads %s", (n, name) => {
    const html = renderToStaticMarkup(<StarCellView stars={n} labels={en.home.docket.stars} />);
    expect(html).toContain(`aria-label="${name}"`);
    expect(html).toContain(`data-stars="${n}"`);
  });

  it("a rejected read renders nothing", async () => {
    expect(
      await StarCellLoaded({
        load: () => Promise.reject(new Error("x")),
        labels: en.home.docket.stars,
      }),
    ).toBeNull();
  });
});
