import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { createRaceStore } from "../client/store";
import { RaceStoreProvider } from "../client/use-race-store";
import { RaceSeatLive } from "../seat/race-seat-live";
import { RaceAnnouncer } from "./race-announcer";

// Contract of #242 C2: one visually hidden polite status region, atomic, is the race's announcer; the
// countdown (#214) and the overtake and finish stamps (#232, #240) write through it, so the seat's live
// leaf holds exactly one announcer and the stamps themselves stay hidden from assistive tech.

const labelsOf = (cat: typeof en | typeof fr) => ({
  announce: cat.race.announce,
  countdown: cat.race.countdown,
  stamps: cat.race.stamps,
});

const regions = (html: string) => html.match(/<[^>]*data-announcer[^>]*>/g) ?? [];

describe("#242 C2 RaceAnnouncer", () => {
  it("renders one visually hidden role=status region, polite and atomic, empty at first", () => {
    const html = renderToStaticMarkup(
      <RaceStoreProvider store={createRaceStore()}>
        <RaceAnnouncer step={null} labels={labelsOf(en)} />
      </RaceStoreProvider>,
    );
    const [region, ...more] = regions(html);
    expect(more).toEqual([]);
    expect(region).toContain('role="status"');
    expect(region).toContain('aria-live="polite"');
    expect(region).toContain('aria-atomic="true"');
    expect(region).toMatch(/class="[^"]*srOnly/);
    expect(region).not.toContain("aria-hidden");
    expect(html.replace(/<[^>]+>/g, "")).toBe("");
  });

  it("the seat's live leaf holds exactly one announcer and no other polite region of its own (#214, #232)", () => {
    for (const cat of [en, fr]) {
      const html = renderToStaticMarkup(
        <RaceStoreProvider store={createRaceStore()}>
          <RaceSeatLive
            code="KGB-4821"
            lobbyId="00000000-0000-4000-8000-000000000000"
            mint={async () => ({ ok: false, error: "generic" }) as never}
            labels={{
              loading: cat.race.loading,
              notice: cat.race.notice,
              errors: cat.race.errors,
              countdown: cat.race.countdown,
              input: cat.race.telex.strip,
              stamps: cat.race.stamps,
              announce: cat.race.announce,
              finish: cat.race.finish,
              exit: cat.race.exit,
            }}
          />
        </RaceStoreProvider>,
      );
      expect(regions(html)).toHaveLength(1);
      expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
      expect(html).not.toContain('aria-live="assertive"');
    }
  });
});
