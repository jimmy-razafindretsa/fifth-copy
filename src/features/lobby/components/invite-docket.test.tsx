import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions/create-invite", () => ({ createInvite: vi.fn() }));
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { copiedHoldMs, copyRoomCode, InviteDocket, InviteRow } from "./invite-docket";
import { IDLE_LINK, InviteLinkRowView, linkErrorCopy, type LinkRowState } from "./invite-link-row";
import { RoomCodeDocket } from "./room-code-docket";

// Contract of #498 C4: the room docket's invite row, a 7.1 ink button COPY that writes the code to the
// clipboard and reads COPIED for --motion-duration-slow x 3, falling back to selecting the code.
const CODE = "KGB-4821";
const labels = en.lobby;

describe("copyRoomCode", () => {
  it("writes the code to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    const select = vi.fn();
    await expect(copyRoomCode(CODE, { clipboard: { writeText }, select })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(select).not.toHaveBeenCalled();
  });

  it("selects the code text when the clipboard API is unavailable", async () => {
    const select = vi.fn();
    await expect(copyRoomCode(CODE, { clipboard: undefined, select })).resolves.toBe("selected");
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("selects the code text when the clipboard refuses (no permission, insecure context)", async () => {
    const select = vi.fn();
    const writeText = vi.fn(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    await expect(copyRoomCode(CODE, { clipboard: { writeText }, select })).resolves.toBe(
      "selected",
    );
    expect(select).toHaveBeenCalledTimes(1);
  });
});

describe("copiedHoldMs", () => {
  it("is the slow motion token times three", () => {
    expect(copiedHoldMs("600ms")).toBe(1800);
    expect(copiedHoldMs(" 0.6s ")).toBe(1800);
  });

  it("is 0 under reduced motion (the token is 0ms) or without a token: COPIED then holds until blur", () => {
    expect(copiedHoldMs("0ms")).toBe(0);
    expect(copiedHoldMs("")).toBe(0);
    expect(copiedHoldMs("fast")).toBe(0);
  });
});

describe("InviteRow view", () => {
  it("idle: the INVITE row with the ink COPY button", () => {
    const html = renderToStaticMarkup(
      <dl>
        <InviteDocket code={CODE} codeId="c" labels={labels.invite} />
      </dl>,
    );
    expect(html).toContain(">INVITE</dt>");
    expect(html).toMatch(/<button type="button" class="[^"]*ink[^"]*"[^>]*>COPY<\/button>/);
    expect(html).toContain('role="status"');
  });

  it("copied: the button reads COPIED and the live region says so", () => {
    const html = renderToStaticMarkup(
      <dl>
        <InviteRow status="copied" labels={labels.invite} onCopy={() => {}} onBlur={() => {}} />
      </dl>,
    );
    expect(html).toContain(">COPIED</button>");
    expect(html).toContain(labels.invite.copiedStatus);
  });

  it("selected (no clipboard): the button keeps COPY, the live region says the code is selected", () => {
    const html = renderToStaticMarkup(
      <dl>
        <InviteRow status="selected" labels={labels.invite} onCopy={() => {}} onBlur={() => {}} />
      </dl>,
    );
    expect(html).toContain(">COPY</button>");
    expect(html).toContain(labels.invite.selectedStatus);
  });

  it("French", () => {
    const html = renderToStaticMarkup(
      <dl>
        <InviteRow status="copied" labels={fr.lobby.invite} onCopy={() => {}} onBlur={() => {}} />
      </dl>,
    );
    expect(html).toContain(">COPIÉ</button>");
    expect(html).toContain(">INVITATION</dt>");
  });

  it("the links slot (#121) renders after the copy row", () => {
    const html = renderToStaticMarkup(
      <dl>
        <InviteDocket code={CODE} codeId="c" labels={labels.invite} links={<div>LINK</div>} />
      </dl>,
    );
    expect(html.indexOf("COPY")).toBeLessThan(html.indexOf("LINK"));
  });
});

describe("RoomCodeDocket keeps its rows and takes the invite rows after them", () => {
  it("TYPISTS, STATUS, then the children", () => {
    const html = renderToStaticMarkup(
      <RoomCodeDocket code={CODE} count={2} seats={30} labels={labels}>
        <InviteDocket code={CODE} codeId="lobby-room-code" labels={labels.invite} />
      </RoomCodeDocket>,
    );
    const order = [">TYPISTS<", ">STATUS<", ">INVITE<"].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(`id="lobby-room-code"`);
    expect(html.match(new RegExp(CODE, "g"))).toHaveLength(1);
  });
});

// #809 C4: the host's link row: LINK | NEW LINK (ISSUING… pending), the issued URL (mono, one line,
// ellipsis, title) with its own COPY, the polite status, and a refusal as the 7.4 inline error line.
describe("InviteLinkRowView (#809 C4)", () => {
  const URL = "http://localhost:3000/invite/" + "A".repeat(43);
  const linkRow = (state: LinkRowState, catalog = en) =>
    renderToStaticMarkup(
      <dl>
        <InviteLinkRowView
          state={state}
          labels={catalog.lobby.links}
          errors={catalog.landing.errors}
          urlId="u"
          errorId="e"
        />
      </dl>,
    );

  it("idle: LINK | the ink NEW LINK button, no URL", () => {
    const html = linkRow(IDLE_LINK);
    expect(html).toContain(">LINK</dt>");
    expect(html).toMatch(/<button type="button" class="[^"]*ink[^"]*"[^>]*>NEW LINK<\/button>/);
    expect(html).not.toContain("/invite/");
    expect(html).toMatch(/class="[^"]*invite[^"]*"/);
  });

  it("pending: ISSUING…, disabled and aria-busy", () => {
    const html = linkRow({ ...IDLE_LINK, pending: true });
    expect(html).toMatch(/disabled="" aria-busy="true"[^>]*>ISSUING…</);
  });

  it("shown: the URL with its title, then its own COPY", () => {
    const html = linkRow({ ...IDLE_LINK, url: URL });
    expect(html).toContain(`title="${URL}"`);
    expect(html).toContain(`>${URL}</span>`);
    expect(html.indexOf(URL)).toBeLessThan(html.lastIndexOf(">COPY</button>"));
    expect(html).toContain(">NEW LINK</button>");
  });

  it("copied: COPIED and the polite status; selected: the selection status", () => {
    const copied = linkRow({ ...IDLE_LINK, url: URL, copy: "copied" });
    expect(copied).toContain(">COPIED</button>");
    expect(copied).toContain(">Invite link copied</span>");
    const selected = linkRow({ ...IDLE_LINK, url: URL, copy: "selected" });
    expect(selected).toContain(en.lobby.links.selectedStatus);
  });

  it("error: the 7.4 inline error line, the button described by it", () => {
    const html = linkRow({ ...IDLE_LINK, error: "not-host" });
    expect(html).toContain('role="alert"');
    expect(html).toContain(en.lobby.links.notHost);
    expect(html).toContain('aria-describedby="e"');
  });

  it("every refusal maps to a sentence", () => {
    const l = en.lobby.links;
    const e = en.landing.errors;
    expect(linkErrorCopy(l, e, "closed")).toBe(e.closed);
    expect(linkErrorCopy(l, e, "unavailable")).toBe(e.unavailable);
    expect(linkErrorCopy(l, e, "rate-limited")).toBe(e.generic);
    expect(linkErrorCopy(l, e, "invalid")).toBe(e.generic);
  });

  it("French", () => {
    const html = linkRow({ ...IDLE_LINK, url: URL, copy: "copied" }, fr);
    expect(html).toContain(">LIEN</dt>");
    expect(html).toContain(">NOUVEAU LIEN</button>");
    expect(html).toContain(">COPIÉ</button>");
    expect(html).toContain("Lien d&#x27;invitation copié");
  });
});
