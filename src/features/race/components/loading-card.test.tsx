import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { LoadingCard } from "./loading-card";

// #563 C2 (bible 7.4 extension): the scene's loading card, a busy status docket with the ink stamp and an
// optional "Did you know?" row.

describe("LoadingCard (#563 C2)", () => {
  it("is a busy status docket with the LOADING THE RING ROOM stamp", () => {
    const html = renderToStaticMarkup(<LoadingCard labels={en.race.scene} tip={null} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="LOADING THE RING ROOM"');
    expect(html).toContain('data-stamp-tone="ink"');
    expect(html).toContain(">LOADING THE RING ROOM<");
    expect(html).not.toContain("data-did-you-know");
  });

  it("shows one tip row when there is a line, in the page's language", () => {
    const html = renderToStaticMarkup(
      <LoadingCard labels={fr.race.scene} tip="La première machine à écrire date de 1868." />,
    );
    expect(html).toContain(">CHARGEMENT DE LA SALLE<");
    expect(html).toContain("data-did-you-know");
    expect(html).toContain(">LE SAVAIS-TU ?<");
    expect(html).toContain("La première machine à écrire date de 1868.");
  });

  it("the catalogs ship an empty tip list until #383", () => {
    expect(en.race.didYouKnow).toEqual([]);
    expect(fr.race.didYouKnow).toEqual([]);
  });

  it("#926 C5: while the room loads, the READY row sits between the stamp and the tip", () => {
    const html = renderToStaticMarkup(
      <LoadingCard labels={en.race.scene} tip="A line." ready="01 / 02" />,
    );
    expect(html).toContain("data-ready");
    expect(html).toContain(">READY<");
    expect(html).toContain(">01 / 02<");
    expect(html.indexOf("LOADING THE RING ROOM<")).toBeLessThan(html.indexOf("data-ready"));
    expect(html.indexOf("data-ready")).toBeLessThan(html.indexOf("data-did-you-know"));
    const fr926 = renderToStaticMarkup(
      <LoadingCard labels={fr.race.scene} tip={null} ready="00 / 03" />,
    );
    expect(fr926).toContain(">PRÊTS<");
    expect(fr926).toContain(">00 / 03<");
    expect(renderToStaticMarkup(<LoadingCard labels={en.race.scene} tip={null} />)).not.toContain(
      "data-ready",
    );
  });
});
