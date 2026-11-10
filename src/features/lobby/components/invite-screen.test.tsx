import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { InviteScreenView } from "./invite-screen";

// #809 C1: the invitation screen of /invite/[token]: kicker, H1, the FORM | INVITE and SEATS | ONE
// docket (no room code), and the TAKE YOUR DESK stamp button inside a form that posts the token.
vi.mock("../actions/take-invite", () => ({ takeInvite: vi.fn() }));
vi.mock("../actions/join-by-code", () => ({ joinByCode: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const TOKEN = "A".repeat(43);
const render = (catalog: typeof en, outcome: "invite" | "refused" = "invite", pending = false) =>
  renderToStaticMarkup(
    <InviteScreenView
      outcome={outcome}
      token={TOKEN}
      pending={pending}
      labels={catalog.invite}
      errors={catalog.landing.errors}
      entry={catalog.landing.actions}
    />,
  );

describe("invitation screen (#809 C1)", () => {
  it("kicker, H1, the two docket rows, then the stamp button in a form", () => {
    const html = render(en);
    const order = [
      ">MINISTRY OF TYPING · INVITATION<",
      ">YOU ARE EXPECTED</h1>",
      "<dt>FORM</dt><dd>INVITE</dd>",
      "<dt>SEATS</dt><dd>ONE</dd>",
      ">TAKE YOUR DESK</button>",
    ].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toMatch(
      /<form[^>]*>.*<button type="submit"[^>]*>TAKE YOUR DESK<\/button><\/form>/,
    );
    expect(html).toContain(`<input type="hidden" name="token" value="${TOKEN}"/>`);
    expect(html).not.toMatch(/[A-HJ-NP-Z]{3}-\d{4}/);
  });

  it("French", () => {
    const html = render(fr);
    expect(html).toContain(">MINISTÈRE DE LA DACTYLOGRAPHIE · INVITATION<");
    expect(html).toContain(">ON T&#x27;ATTEND</h1>");
    expect(html).toContain(">PRENDS TA PLACE</button>");
  });

  it("pending: the button is disabled and aria-busy", () => {
    expect(render(en, "invite", true)).toMatch(/disabled="" aria-busy="true"[^>]*>TAKE YOUR DESK</);
  });

  it("a refused outcome swaps the whole screen for the refusal", () => {
    const html = render(en, "refused");
    expect(html).not.toContain("TAKE YOUR DESK");
    expect(html).toContain("REFUSED");
  });
});
