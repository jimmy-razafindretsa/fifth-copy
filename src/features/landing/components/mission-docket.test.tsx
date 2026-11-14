import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import {
  MissionDocketLoaded,
  MissionDocketView,
  type MissionProgress,
  type Missions,
} from "./mission-docket";

type MissionId = MissionProgress["id"];

// #943 C18, C20: the mission docket's three templates, both languages, the complete state, a failed read.
const TARGET: Record<MissionId, number> = { "accuracy-95": 3, "finish-3": 3, "accuracy-98": 1 };
const view = (id: MissionId, progress: number, t = en) =>
  renderToStaticMarkup(
    <MissionDocketView
      mission={{ id, target: TARGET[id], progress, complete: progress >= TARGET[id] }}
      labels={t.home.mission}
    />,
  );

describe("MissionDocketView (C18)", () => {
  it.each([
    ["accuracy-95", en, "3 races at 95 % accuracy"],
    ["finish-3", en, "Finish 3 races"],
    ["accuracy-98", en, "1 race at 98 % accuracy"],
    ["accuracy-95", fr, "3 courses à 95 % de précision"],
    ["finish-3", fr, "Termine 3 courses"],
    ["accuracy-98", fr, "1 course à 98 % de précision"],
  ] as const)("%s reads its line", (id, t, line) => {
    const html = view(id, 0, t as typeof en);
    expect(html).toContain(`>${t.home.mission.title}<`);
    expect(html).toContain(`>${line}<`);
    expect(html).toContain(`>0 / ${TARGET[id]}<`);
  });

  it("the bar has target segments, progress of them done", () => {
    const html = view("finish-3", 1);
    expect(html).toMatch(
      /role="progressbar"[^>]*aria-valuemin="0" aria-valuemax="3" aria-valuenow="1"/,
    );
    expect(html.match(/data-done="true"/g)).toHaveLength(1);
    expect(html.match(/data-done="false"/g)).toHaveLength(2);
    expect(html).toContain('data-complete="false"');
    expect(html).not.toContain("data-mission-done");
  });

  it.each([en, fr])("complete: every segment done, the DONE tag with a gold star and +1", (t) => {
    const html = view("accuracy-98", 1, t as typeof en);
    expect(html).toContain('data-complete="true"');
    expect(html).not.toContain('data-done="false"');
    expect(html).toContain(`${t.home.mission.done}<span`);
    expect(html).toContain(">+1<");
  });
});

describe("MissionDocketLoaded (C20)", () => {
  const labels = en.home.mission;
  it("a rejected read renders nothing", async () => {
    const node = await MissionDocketLoaded({
      load: () => Promise.reject(new Error("db down")),
      labels,
    });
    expect(node).toBeNull();
  });

  it("no viewer renders nothing; a read renders the docket", async () => {
    expect(await MissionDocketLoaded({ load: async () => null, labels })).toBeNull();
    const missions: Missions = {
      today: { id: "finish-3", target: 3, progress: 2, complete: false },
    };
    const node = await MissionDocketLoaded({ load: async () => missions, labels });
    expect(renderToStaticMarkup(node!)).toContain(">2 / 3<");
  });
});
