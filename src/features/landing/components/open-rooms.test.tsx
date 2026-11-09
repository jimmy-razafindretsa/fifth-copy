import { renderToReadableStream, renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ListOpenLobbiesResult, OpenLobby } from "@/features/lobby";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { OPEN_ROOMS_MAX, OpenRooms, OpenRoomsDocket, OpenRoomsLoaded } from "./open-rooms";

// #807 C2, C3: the docket's four states, rendered on the server as the landing streams them.
const room = (code: string, typists: number, bots: number): OpenLobby => ({
  code,
  typists,
  bots,
  seats: 30,
});
const labels = { labels: en.landing.rooms, errors: en.landing.errors };
const docket = (result: ListOpenLobbiesResult, l = labels) =>
  renderToStaticMarkup(<OpenRoomsDocket result={result} {...l} />);

describe("OpenRooms (#807)", () => {
  it("C2 loading: the Suspense fallback is three aria-busy skeleton rows under the header", () => {
    const html = renderToString(<OpenRooms load={() => new Promise(() => {})} {...labels} />);
    expect(html).toContain(">OPEN ROOMS</h2>");
    expect(html).toContain(">LIVE<");
    expect(html).toMatch(/<ul[^>]*aria-label="Open rooms"[^>]*aria-busy="true"/);
    expect(html.match(/data-skeleton/g)).toHaveLength(3);
    expect(html).toContain("Looking for open rooms…");
    expect(html).not.toContain("JOIN");
    // flat blocks: no gradient anywhere in the fallback
    expect(html).not.toContain("gradient");
  });

  it("C2 streamed: one docket and one title id, the rows swapped in under it", async () => {
    let answer!: (result: ListOpenLobbiesResult) => void;
    const pending = new Promise<ListOpenLobbiesResult>((resolve) => (answer = resolve));
    const stream = await renderToReadableStream(<OpenRooms load={() => pending} {...labels} />);
    answer({ ok: true, lobbies: [room("KGB-4821", 2, 1)] });
    const html = await new Response(stream).text();
    // the fallback rows and the streamed rows coexist until the swap; the shell never does
    expect(html.match(/data-open-rooms/g)).toHaveLength(1);
    expect(html.match(/id="open-rooms-title"/g)).toHaveLength(1);
    expect(html.match(/<h2/g)).toHaveLength(1);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Join room KGB-4821"');
  });

  it("C1 populated: one row per room, code | counts then JOIN → to its waiting room", async () => {
    const html = renderToStaticMarkup(
      await OpenRoomsLoaded({
        load: async () => ({ ok: true, lobbies: [room("KGB-4821", 3, 2), room("TAS-1978", 1, 1)] }),
        ...labels,
      }),
    );
    expect(html).not.toContain("aria-busy");
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain(">KGB-4821<");
    expect(html).toContain(">3 TYPISTS · 2 BOTS<");
    expect(html).toContain(">1 TYPIST · 1 BOT<");
    const link = html.match(/<a [^>]*href="\/lobby\/KGB-4821"[^>]*>JOIN →<\/a>/)?.[0];
    expect(link).toContain('aria-label="Join room KGB-4821"');
    expect(html).toContain('href="/lobby/TAS-1978"');
    // the query's order is kept (busiest first)
    expect(html.indexOf("KGB-4821")).toBeLessThan(html.indexOf("TAS-1978"));
  });

  it("C1 at most five rows", () => {
    const lobbies = Array.from({ length: 7 }, (_, i) => room(`ABC-100${i}`, 7 - i, 0));
    const html = docket({ ok: true, lobbies });
    expect(html.match(/<li/g)).toHaveLength(OPEN_ROOMS_MAX);
    expect(html).not.toContain("ABC-1005");
    expect(html).toContain(">7 TYPISTS · 0 BOTS<");
  });

  it("C1 French: SALLES OUVERTES, EN DIRECT, DACTYLOS and REJOINDRE →", () => {
    const html = docket(
      { ok: true, lobbies: [room("KGB-4821", 3, 2), room("TAS-1978", 1, 0)] },
      { labels: fr.landing.rooms, errors: fr.landing.errors },
    );
    expect(html).toContain(">SALLES OUVERTES</h2>");
    expect(html).toContain(">EN DIRECT<");
    expect(html).toContain(">3 DACTYLOS · 2 BOTS<");
    expect(html).toContain(">1 DACTYLO · 0 BOT<");
    expect(html).toContain('aria-label="Rejoindre la salle KGB-4821"');
    expect(html).toContain(">REJOINDRE →<");
  });

  it("C3 empty: one still statement row, no list", () => {
    const html = docket({ ok: true, lobbies: [] });
    expect(html).toContain(">NO OPEN ROOM · PRESS QUICK RACE</p>");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain('role="alert"');
    expect(
      docket({ ok: true, lobbies: [] }, { labels: fr.landing.rooms, errors: fr.landing.errors }),
    ).toContain("AUCUNE SALLE OUVERTE · APPUIE SUR COURSE RAPIDE");
  });

  it("C3 error: the inline error line with the unavailable sentence, role=alert", () => {
    const html = docket({ ok: false, error: "race-server-unavailable" });
    expect(html).toMatch(
      /<p role="alert"[^>]*><span[^>]*>RETURNED ·<\/span> The ring rooms are not answering\. Try again in a minute\.<\/p>/,
    );
    expect(html).not.toContain("<ul");
    expect(html).toContain(">OPEN ROOMS</h2>");
  });
});
