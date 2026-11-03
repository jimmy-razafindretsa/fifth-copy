import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { deskIdentity, type Member } from "@fifth-copy/protocol";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { initialsOf, SeatRing } from "./seat-ring";

// Contract of #731 C1-C3: the waiting room's seat ring (bible 1, 14.3, 7.4 grids, 3.1 rival inks, 3.2
// `you`). Markup through react-dom/server, the recipe through the CSS module's text (computed colours,
// contrast and the 480px rule run in e2e/lobby.spec.ts).

const css = readFileSync(
  path.join(process.cwd(), "src/features/lobby/components/seat-ring.module.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, selector).not.toBeNull();
  return match![1]!;
}

const member = (desk: number, name: string, extra: Partial<Member> = {}): Member => ({
  desk,
  name,
  isHost: false,
  isBot: false,
  ...deskIdentity(desk),
  ...extra,
});

const host = member(1, "Sparrow-482", { isHost: true });
const guest = member(2, "Jean Luc Picard");
const bot = member(3, "Clerk Novak", { isBot: true });

const render = (members: Member[], you: number | null = 1, labels = en.lobby.ring) =>
  renderToStaticMarkup(<SeatRing members={members} you={you} seats={30} labels={labels} />);

/** Each cell's opening tag and content, in desk order. */
function cells(html: string): string[] {
  return [...html.matchAll(/<span[^>]*data-desk="\d+"[\s\S]*?(?=<span[^>]*data-desk="|<\/div>$)/g)].map(
    (m) => m[0],
  );
}

describe("SeatRing layout (C1)", () => {
  it("draws 30 cells numbered 01-30, each placed by rotate(i x 12deg) translate(r), counter-rotated", () => {
    const html = render([]);
    const all = cells(html);
    expect(all).toHaveLength(30);
    all.forEach((cell, i) => {
      const n = String(i + 1).padStart(2, "0");
      expect(cell).toContain(`data-desk="${i + 1}"`);
      expect(cell).toContain(`>${n}<`);
      const a = i * 12;
      expect(cell).toContain(
        `transform:rotate(${a}deg) translateY(calc(-1 * var(--ring-r))) rotate(${-a}deg)`,
      );
    });
  });

  it("holds the ink tag THE MAJOR / LE MAJOR at the centre; no canvas, no three", () => {
    expect(render([])).toMatch(/<span class="[^"]*major[^"]*"[^>]*>THE MAJOR<\/span>/);
    expect(render([], 1, fr.lobby.ring)).toContain(">LE MAJOR<");
    expect(render([host, guest, bot])).not.toMatch(/<canvas|<svg/);
    const source = readFileSync(
      path.join(process.cwd(), "src/features/lobby/components/seat-ring.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/from "three"|@\/features\/race|race-3d/);
  });

  it("cells are paper faces on the 7.4 ink gap (2px ink plate), never per-cell borders on a taken cell", () => {
    const plate = rule(".cell");
    expect(plate).toMatch(/padding:\s*2px/);
    expect(plate).toMatch(/background:\s*var\(--color-fg\)/);
    expect(plate).not.toMatch(/border:/);
    expect(rule(".face")).toMatch(/background:\s*var\(--color-bg\)/);
    // the desk number: Oswald 600 11px .2em
    const num = rule(".num");
    expect(num).toMatch(/@apply type-label/);
    expect(num).toMatch(/font-size:\s*11px/);
    expect(num).toMatch(/letter-spacing:\s*0\.2em/);
    expect(rule(".major")).toMatch(/background:\s*var\(--color-fg\)/);
    expect(rule(".major")).toMatch(/color:\s*var\(--color-bg\)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|--brand-/i);
  });
});

describe("SeatRing cell states (C2)", () => {
  const html = render([host, guest, bot], 1);
  const all = cells(html);

  it("empty desks are dashed 1px muted with a muted number and no initials", () => {
    const empty = all[29]!;
    expect(empty).toContain('data-state="empty"');
    expect(empty).not.toMatch(/class="[^"]*initials/);
    const e = rule('.cell[data-state="empty"]');
    expect(e).toMatch(/border:\s*1px dashed var\(--color-fg-muted\)/);
    expect(e).toMatch(/background:\s*var\(--color-bg\)/);
    expect(rule('.cell[data-state="empty"] .num')).toMatch(/color:\s*var\(--color-fg-muted\)/);
  });

  it("taken desks show the initials of the first two words and a 4px rule in the desk's rival ink", () => {
    const taken = all[1]!;
    expect(taken).toContain('data-state="taken"');
    expect(taken).toMatch(/class="[^"]*initials[^"]*">JL</);
    expect(taken).toContain(`data-ink="rival-${guest.color}"`);
    expect(rule(".face")).toMatch(/border-top:\s*4px solid var\(--desk-ink\)/);
    for (let i = 0; i < 12; i++)
      expect(rule(`.cell[data-ink="rival-${i}"]`)).toMatch(
        new RegExp(`--desk-ink:\\s*var\\(--color-rival-${i}\\)`),
      );
    // IBM Plex Mono 500 12px
    const initials = rule(".initials");
    expect(initials).toMatch(/@apply type-typing/);
    expect(initials).toMatch(/font-weight:\s*500/);
    expect(initials).toMatch(/font-size:\s*12px/);
  });

  it("the viewer's desk is `you` red with paper text; the host carries a red dot after the number", () => {
    const you = all[0]!;
    expect(you).toContain('data-state="you"');
    expect(you).toContain('data-ink="you"');
    expect(you).toMatch(/class="[^"]*initials[^"]*">S</);
    expect(you).toMatch(/>01<\/span><span class="[^"]*dot/);
    const y = rule('.cell[data-state="you"] .face');
    expect(y).toMatch(/background:\s*var\(--color-you\)/);
    expect(y).toMatch(/color:\s*var\(--color-primary-fg\)/);
    expect(all[1]).not.toMatch(/class="[^"]*dot/);
  });

  it("a bot desk is taken plus the B micro tag (the BOT tag recipe at 9px)", () => {
    const b = all[2]!;
    expect(b).toContain('data-state="taken"');
    expect(b).toContain('data-bot="true"');
    expect(b).toMatch(/class="[^"]*bot[^"]*">B</);
    expect(b).not.toMatch(/class="[^"]*dot/);
    const tag = rule(".bot");
    expect(tag).toMatch(/@apply type-label/);
    expect(tag).toMatch(/font-size:\s*9px/);
    expect(tag).toMatch(/letter-spacing:\s*0\.16em/);
    expect(tag).toMatch(/background:\s*var\(--color-fg\)/);
    expect(tag).toMatch(/color:\s*var\(--color-bg\)/);
    expect(all[0]).not.toContain(">B<");
  });

  it("a spectator (you = null) has no red desk", () => {
    expect(render([host, guest], null)).not.toContain('data-state="you"');
  });

  it("initials: first two words, letters only, upper case", () => {
    expect(initialsOf("Clerk Novak II")).toBe("CN");
    expect(initialsOf("Sparrow-482")).toBe("S");
    expect(initialsOf("héron blanc")).toBe("HB");
    expect(initialsOf("Greffière Tremblay")).toBe("GT");
    expect(initialsOf("1234")).toBe("1");
  });
});

describe("SeatRing accessibility (C3)", () => {
  it("is one role=img named with the count, its cells hidden, never focusable", () => {
    const html = render([host, guest, bot]);
    expect(html.match(/role="img"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Seat ring: 3 of 30 desks taken"');
    expect(html).not.toMatch(/tabindex/i);
    for (const cell of cells(html)) expect(cell).toMatch(/^<span[^>]*aria-hidden="true"/);
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*>THE MAJOR</);
    expect(render([host, guest, bot], 1, fr.lobby.ring)).toContain(
      'aria-label="Anneau des bureaux : 3 bureaux sur 30 occupés"',
    );
  });

  it("the name follows the roster", () => {
    expect(render([host])).toContain('aria-label="Seat ring: 1 of 30 desks taken"');
    const full = Array.from({ length: 30 }, (_, i) => member(i + 1, `Typist ${i + 1}`));
    const html = render(full, 4);
    expect(html).toContain('aria-label="Seat ring: 30 of 30 desks taken"');
    expect(html).not.toContain('data-state="empty"');
  });

  it("is hidden at 480px and under (phones watch, bible 18)", () => {
    expect(css).toMatch(/@media \(max-width: 480px\) \{\s*\.ring \{\s*display: none;/);
  });
});
