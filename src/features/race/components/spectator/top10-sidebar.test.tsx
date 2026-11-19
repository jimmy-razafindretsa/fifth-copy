import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLAYER_STATUS_CODES, type Member } from "@fifth-copy/protocol";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { topTenRows } from "../../view/standings";
import { Top10Sidebar } from "./top10-sidebar";

// Contract of #999 C3 (and the CSS half of C7) at unit level: the projector's top-10 sidebar renders
// `topTenRows` as one 7.4 docket. A 30-desk room shows exactly 10 rows in the server's rank order, each
// with its rival marker, and no row is ever `you` (the projector holds no desk, even the host's tab).

const member = (desk: number): Member => ({
  desk,
  name: `Lynx-${100 + desk}`,
  isHost: desk === 1,
  isBot: false,
  color: (desk - 1) % 12,
  marker: (["circle", "square", "triangle", "diamond"] as const)[Math.floor((desk - 1) / 12) % 4]!,
  avatar: null,
});

function room(n: number, ranks: number[]) {
  const members = Array.from({ length: n }, (_, i) => member(i + 1));
  const desks = members.map(
    (m) =>
      [m.desk, m.desk, m.desk, 0, PLAYER_STATUS_CODES.typing, m.desk] as [
        number,
        number,
        number,
        number,
        number,
        number,
      ],
  );
  return { members, desks, ranks, race: { text: "a".repeat(40) }, ending: null };
}

const html = (n: number, ranks: number[], labels = en) =>
  renderToStaticMarkup(
    <Top10Sidebar
      rows={topTenRows(room(n, ranks), labels.race.finish)}
      count={n}
      labels={labels.race.projector}
    />,
  );
const items = (out: string) => [...out.matchAll(/<li[^>]*data-desk="(\d+)"[^>]*>(.*?)<\/li>/g)];

describe("Top10Sidebar (#999 C3)", () => {
  const ranks = Array.from({ length: 30 }, (_, i) => ((i * 7) % 30) + 1);

  it("a 30-desk room: exactly 10 rows, in the server's rank order, named for assistive tech", () => {
    const out = html(30, ranks);
    expect(out).toMatch(/^<section aria-label="TOP 10" data-top10="true"/);
    expect(out).toContain('<ol aria-label="Top 10 standings"');
    expect(out).toContain(">30 TYPISTS<");
    const rows = items(out);
    expect(rows).toHaveLength(10);
    expect(rows.map((m) => Number(m[1]))).toEqual(ranks.slice(0, 10));
    expect(rows[0]![2]).toContain(">01<");
    expect(rows[9]![2]).toContain(">10<");
    expect(rows[0]![2]).toContain(">Lynx-101<");
    expect(rows[1]![2]).toContain(">20\u00a0%<");
  });

  it("every row wears its rival marker (shape and ink, #565); none is you", () => {
    const out = html(30, ranks);
    const rows = items(out);
    for (const [, desk, body] of rows) {
      const m = member(Number(desk));
      expect(body).toContain(`data-marker="${m.marker}"`);
      expect(body).toContain(`data-ink="rival-${m.color}"`);
    }
    expect(out).not.toContain('data-ink="you"');
    expect(out).not.toContain("data-you");
    expect(out).not.toContain(`>${en.race.finish.you}<`);
  });

  it("before the first snapshot: the roster by desk, no place; in French", () => {
    const rows = topTenRows({ ...room(3, []), desks: [] }, fr.race.finish);
    const out = renderToStaticMarkup(
      <Top10Sidebar rows={rows} count={3} labels={fr.race.projector} />,
    );
    expect(out).toContain(">3 DACTYLOS<");
    expect(out).toContain('aria-label="Classement, 10 premiers"');
    const list = items(out);
    expect(list.map((m) => Number(m[1]))).toEqual([1, 2, 3]);
    expect(list[0]![2]).toContain(">··<");
    expect(list[0]![0]).not.toContain("data-place");
  });

  it("an empty room: the header alone, no list", () => {
    const out = html(0, []);
    expect(out).toContain(">0 TYPISTS<");
    expect(out).not.toContain("<ol");
  });

  it("C7: rows at the projector scale, 28px at 1080p, growing with the screen; the header at 20px", () => {
    const css = readFileSync(path.join(__dirname, "top10-sidebar.module.css"), "utf8");
    expect(css).toContain("--_row: max(28px, min(calc(100vw * 28 / 1920), calc(100vh * 28 / 1080)));");
    expect(css).toContain("--_head: max(20px, min(calc(100vw * 20 / 1920), calc(100vh * 20 / 1080)));");
    for (const part of ["row", "place", "name", "value", "status"]) {
      const rule = new RegExp(`\\.${part} \\{[^}]*font-size: var\\(--_row\\);`);
      expect(css, part).toMatch(rule);
    }
    expect(css).not.toMatch(/overflow-y:\s*auto/);
    expect(css).not.toMatch(/animation|transition/);
  });
});
