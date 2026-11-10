import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { InviteRefused } from "./invite-refused";

// #809 C3: the refusal screen: the ink Stamp at md (REFUSED / LINK USED OR EXPIRED), one sentence,
// the landing's Join with code form and the secondary link to /; rate-limited, unavailable (and
// closed) show the 7.4 inline error line with the landing's sentence instead of the stamp.
vi.mock("../actions/join-by-code", () => ({ joinByCode: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

type Outcome = "refused" | "closed" | "rate-limited" | "unavailable";
const render = (outcome: Outcome, catalog: typeof en = en, announce = false) =>
  renderToStaticMarkup(
    <InviteRefused
      outcome={outcome}
      labels={catalog.invite}
      errors={catalog.landing.errors}
      entry={catalog.landing.actions}
      announce={announce}
    />,
  );

describe("refusal screen (#809 C3)", () => {
  it("not on file: the ink md stamp, the sentence, the join form, the link home", () => {
    const html = render("refused");
    expect(html).toMatch(/class="[^"]*ink[^"]*"/);
    expect(html).toContain("type-display-md");
    const order = [
      ">REFUSED<",
      ">LINK USED OR EXPIRED<",
      ">Ask the host for a new link, or join with the room code.</p>",
      'aria-label="Join with code"',
      '<a href="/"',
      ">REPORT TO YOUR DESK</a>",
    ].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('role="alert"');
  });

  it("after a press the stamp is a status; on a load it is static", () => {
    expect(render("refused", en, true)).toMatch(/role="status"/);
    expect(render("refused")).not.toMatch(/role="status"/);
  });

  it.each([
    ["rate-limited", en.landing.errors.generic],
    ["unavailable", en.landing.errors.unavailable],
    ["closed", en.landing.errors.closed],
  ] as const)("%s: the inline error line instead of the stamp", (outcome, sentence) => {
    const html = render(outcome);
    expect(html).toContain('role="alert"');
    expect(html).toContain(en.landing.errors.prefix);
    expect(html).toContain(sentence.replace(/'/g, "&#x27;"));
    expect(html).not.toContain(">REFUSED<");
    expect(html).toContain('aria-label="Join with code"');
  });

  it("French", () => {
    const html = render("refused", fr);
    expect(html).toContain(">REFUSÉ<");
    expect(html).toContain(">LIEN UTILISÉ OU EXPIRÉ<");
    expect(html).toContain("Demande un nouveau lien à l&#x27;hôte, ou entre le code de la salle.");
    expect(html).toContain(">AU RAPPORT À TON BUREAU</a>");
  });
});
