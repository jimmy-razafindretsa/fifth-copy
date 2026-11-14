import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { OnlineCountLoaded, OnlineFigure } from "./online-count";

// #943 C22: the online figure after the version; nothing when unknown.
describe("online figure (C22)", () => {
  it.each([
    [en, 2, "2 ONLINE", "2 players online"],
    [en, 0, "0 ONLINE", "0 players online"],
    [en, 1, "1 ONLINE", "1 player online"],
    [fr, 2, "2 EN LIGNE", "2 joueurs en ligne"],
  ] as const)("%#: %s reads %s, spoken %s", (t, n, shown, spoken) => {
    const html = renderToStaticMarkup(<OnlineFigure online={n} labels={t.home} />);
    expect(html).toContain(`data-online="${n}"`);
    expect(html).toContain(`>${shown}<`);
    expect(html).toContain(`>${spoken}<`);
    expect(html).toMatch(/aria-hidden="true"> · </);
  });

  it("an answer that is not ok, or a rejected read, renders nothing (no separator, no placeholder)", async () => {
    expect(await OnlineCountLoaded({ load: async () => ({ ok: false }), labels: en.home })).toBeNull();
    expect(await OnlineCountLoaded({ load: () => Promise.reject(new Error("x")), labels: en.home })).toBeNull();
  });

  it("an ok answer renders the figure only", async () => {
    const node = await OnlineCountLoaded({ load: async () => ({ ok: true, online: 7 }), labels: en.home });
    expect(renderToStaticMarkup(node!)).toContain(">7 ONLINE<");
  });
});
