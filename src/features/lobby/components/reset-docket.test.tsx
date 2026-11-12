import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import {
  IDLE_RESET,
  ResetDocketView,
  resetErrorText,
  submitReset,
  type IssueReset,
  type ResetState,
} from "./reset-docket";

// Contract of #790 C2, C4, C5: the host's PASSWORD RESET docket (bible 14.3, 7.4, 7.1, 7.2, 4). The e2e
// (e2e/lobby-reset.spec.ts) covers the render gate (C1) and the issued code end to end (C3).
const labels = en.lobby.reset;
const prefix = en.landing.errors.prefix;
const ids = { input: "s", error: "e" };
const view = (state: ResetState, l = labels) =>
  renderToStaticMarkup(
    <ResetDocketView state={state} labels={l} prefix={prefix} ttlMinutes={30} ids={ids} />,
  );
const TYPED = "ada_lovelace";

describe("ResetDocketView", () => {
  it("C2 default: the FORM 5-R · PASSWORD RESET header, the STUDENT row naming its input, ISSUE A CODE", () => {
    const html = view(IDLE_RESET);
    expect(html).toContain('aria-label="PASSWORD RESET"');
    expect(html).toContain(">FORM 5-R</span>");
    expect(html).toContain(">PASSWORD RESET</span>");
    expect(html).toMatch(/<label for="s"[^>]*>STUDENT<\/label><input id="s"[^>]*name="username"/);
    expect(html).toMatch(/<button type="submit"[^>]*>ISSUE A CODE<\/button>/);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("aria-busy");
  });

  it("C2 French: RÉINITIALISATION, ÉLÈVE, ÉMETTRE UN CODE", () => {
    const html = view(IDLE_RESET, fr.lobby.reset);
    expect(html).toContain(">RÉINITIALISATION</span>");
    expect(html).toContain(">ÉLÈVE</label>");
    expect(html).toContain(">ÉMETTRE UN CODE</button>");
  });

  it("C4 pending: the button is disabled and aria-busy, reading ISSUING…", () => {
    const html = view({ status: "pending" });
    expect(html).toMatch(
      /<button type="submit"[^>]*disabled=""[^>]*aria-busy="true"[^>]*>ISSUING…/,
    );
  });

  it("C3 issued: the success alert row with the code, the expiry and the hand-over line", () => {
    const html = view({ status: "issued", code: "7K2M-Q9XA" });
    expect(html).toMatch(/role="status"/);
    expect(html).toContain("CODE ISSUED");
    expect(html).toMatch(/data-reset-code="true"[^>]*>7K2M-Q9XA<\/span>/);
    expect(html).toContain("EXPIRES IN 30 MIN");
    expect(html).toContain("HAND IT OVER IN PRIVATE");
    const french = view({ status: "issued", code: "7K2M-Q9XA" }, fr.lobby.reset);
    expect(french).toContain("EXPIRE DANS 30 MIN");
    expect(french).toContain("À REMETTRE EN PRIVÉ");
  });

  it.each(["not-eligible", "not-host", "rate-limited", "invalid", "generic"] as const)(
    "C4 %s: the inline error line, linked to the input, never echoing the username",
    (error) => {
      const state: ResetState = { status: "error", error, retryAfterMs: 90_000 };
      const html = view(state);
      expect(html).toMatch(/aria-invalid="true" aria-describedby="e"/);
      expect(html).toMatch(new RegExp(`<p id="e" role="alert"[^>]*><span[^>]*>RETURNED ·</span> `));
      expect(html).toContain(resetErrorText(labels, state).replace("'", "&#x27;"));
      expect(html).not.toContain(TYPED);
      expect(html).not.toContain("CODE ISSUED");
    },
  );

  it("C4 rate-limited reads the wait in whole minutes, at least 1", () => {
    expect(
      resetErrorText(labels, { status: "error", error: "rate-limited", retryAfterMs: 90_000 }),
    ).toBe("Too many codes issued. Try again in 2 min.");
    expect(
      resetErrorText(labels, { status: "error", error: "rate-limited", retryAfterMs: 0 }),
    ).toBe("Too many codes issued. Try again in 1 min.");
  });
});

describe("submitReset", () => {
  const input = { code: "KGB-4821", username: TYPED };

  it("goes pending, then holds the issued code", async () => {
    const set = vi.fn();
    const issue: IssueReset = async () => ({ ok: true, code: "7K2M-Q9XA", expiresAt: new Date() });
    await expect(submitReset(issue, input, set)).resolves.toEqual({
      status: "issued",
      code: "7K2M-Q9XA",
    });
    expect(set.mock.calls).toEqual([
      [{ status: "pending" }],
      [{ status: "issued", code: "7K2M-Q9XA" }],
    ]);
  });

  it("passes the lobby code and the typed username to the action, once", async () => {
    const issue = vi.fn<IssueReset>(async () => ({ ok: false, error: "not-eligible" }));
    await submitReset(issue, input, () => {});
    expect(issue).toHaveBeenCalledExactlyOnceWith(input);
  });

  it.each([
    [
      { ok: false, error: "not-eligible" },
      { status: "error", error: "not-eligible" },
    ],
    [
      { ok: false, error: "not-host" },
      { status: "error", error: "not-host" },
    ],
    [
      { ok: false, error: "invalid" },
      { status: "error", error: "invalid" },
    ],
    [
      { ok: false, error: "rate-limited", retryAfterMs: 42_000 },
      { status: "error", error: "rate-limited", retryAfterMs: 42_000 },
    ],
  ] as const)("a refusal %j is the error state %j", async (result, state) => {
    await expect(
      submitReset(
        async () => result,
        input,
        () => {},
      ),
    ).resolves.toEqual(state);
  });

  it("a thrown call is the generic error", async () => {
    const issue: IssueReset = async () => {
      throw new Error("network");
    };
    await expect(submitReset(issue, input, () => {})).resolves.toEqual({
      status: "error",
      error: "generic",
    });
  });
});

describe("catalogs (C5)", () => {
  it("lobby.reset has the same keys in fr and en", () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === "object" ? keys(v).map((s) => `${k}.${s}`) : [k],
      );
    expect(keys(fr.lobby.reset).sort()).toEqual(keys(en.lobby.reset).sort());
  });
});
