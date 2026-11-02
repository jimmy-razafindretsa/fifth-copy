import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { copiedHoldMs, copyRoomCode, InviteDocket, InviteRow } from "./invite-docket";
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
