import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { createLobby } from "../actions/create-lobby";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fr } from "@/i18n/fr";
import { joinByCode } from "../actions/join-by-code";
import { createPracticeLobby } from "../actions/create-practice-lobby";
import { PracticeButtonView, makePracticeAction } from "./practice-button";
import { CreateLobbyButtonView, makeCreateAction } from "./create-lobby-button";
import { JoinByCodeFormView, makeJoinAction } from "./join-by-code-form";
import type { EntryError } from "./entry-errors";

// Contract of #99, C4 and C7. Labels come from the catalog, never literals (C5 greps `src`).
vi.mock("../actions/create-lobby", () => ({ createLobby: vi.fn() }));
vi.mock("../actions/join-by-code", () => ({ joinByCode: vi.fn() }));
vi.mock("../actions/create-practice-lobby", () => ({ createPracticeLobby: vi.fn() }));

const labels = en.landing.actions;
const errors = en.landing.errors;
const ids = { input: "code", error: "code-error" };

function form(code: string) {
  const data = new FormData();
  data.set("code", code);
  return data;
}

const joinView = (error: EntryError | null, pending = false) =>
  renderToStaticMarkup(
    <JoinByCodeFormView
      value=""
      pending={pending}
      error={error}
      labels={labels}
      errors={errors}
      ids={ids}
    />,
  );

beforeEach(() => {
  vi.mocked(createLobby).mockReset();
  vi.mocked(joinByCode).mockReset();
  vi.mocked(createPracticeLobby).mockReset();
});

describe("join action (C3, C4)", () => {
  it("rejects a malformed code without calling the server", async () => {
    const navigate = vi.fn();
    const state = await makeJoinAction(navigate)({ error: null }, form("KG-1"));
    expect(state).toEqual({ error: "invalid-format" });
    expect(joinByCode).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("normalizes the code and navigates on ok", async () => {
    vi.mocked(joinByCode).mockResolvedValue({ ok: true, code: "KGB-4821" as never });
    const navigate = vi.fn();
    const state = await makeJoinAction(navigate)({ error: null }, form("kgb4821"));
    expect(joinByCode).toHaveBeenCalledWith({ code: "KGB-4821" });
    expect(navigate).toHaveBeenCalledWith("/lobby/KGB-4821");
    expect(state).toEqual({ error: null });
  });

  it.each([
    ["not-found", errors.notFound],
    ["closed", errors.closed],
  ] as const)("renders the server's %s as an inline error", async (error, message) => {
    vi.mocked(joinByCode).mockResolvedValue({ ok: false, error });
    const state = await makeJoinAction(vi.fn())({ error: null }, form("KGB-4821"));
    expect(state).toEqual({ error });
    const html = joinView(state.error);
    expect(html).toContain('role="alert"');
    expect(html).toContain(errors.prefix);
    expect(html).toContain(message);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="code-error"');
  });

  it("turns a thrown action into the generic line and keeps the form usable", async () => {
    vi.mocked(joinByCode).mockRejectedValue(new Error("db down: secret detail"));
    const state = await makeJoinAction(vi.fn())({ error: null }, form("KGB-4821"));
    expect(state).toEqual({ error: "generic" });
    const html = joinView(state.error);
    expect(html).toContain(errors.generic);
    expect(html).not.toContain("secret detail");
    expect(html).not.toContain("disabled");
  });

  it("has no error wiring while valid", () => {
    const html = joinView(null);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("aria-describedby");
  });
});

describe("create action (C4)", () => {
  it("navigates the host to the new lobby", async () => {
    vi.mocked(createLobby).mockResolvedValue({ ok: true, code: "KGB-4821" as never });
    const navigate = vi.fn();
    expect(await makeCreateAction(navigate)()).toEqual({ error: null });
    expect(navigate).toHaveBeenCalledWith("/lobby/KGB-4821");
  });

  it("maps an unavailable race server and a throw to error lines", async () => {
    vi.mocked(createLobby).mockResolvedValue({ ok: false, error: "race-server-unavailable" });
    expect(await makeCreateAction(vi.fn())()).toEqual({ error: "race-server-unavailable" });
    vi.mocked(createLobby).mockResolvedValue({ ok: false, error: "invalid-settings" });
    expect(await makeCreateAction(vi.fn())()).toEqual({ error: "generic" });
    vi.mocked(createLobby).mockRejectedValue(new Error("boom"));
    expect(await makeCreateAction(vi.fn())()).toEqual({ error: "generic" });
    const html = renderToStaticMarkup(
      <CreateLobbyButtonView pending={false} error="generic" labels={labels} errors={errors} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(errors.generic);
  });
});

describe("pending states (C7)", () => {
  it("create shows CREATING…, aria-busy and disabled", () => {
    const html = renderToStaticMarkup(
      <CreateLobbyButtonView pending error={null} labels={labels} errors={errors} />,
    );
    expect(html).toContain(labels.creating);
    expect(html).not.toContain(labels.createPrivateRace);
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-busy="true"|<button[^>]*aria-busy="true"[^>]*disabled=""/,
    );
  });

  it("join shows JOINING…, aria-busy and disabled", () => {
    const html = joinView(null, true);
    expect(html).toContain(labels.joining);
    expect(html).not.toContain(`>${labels.join}<`);
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-busy="true"|<button[^>]*aria-busy="true"[^>]*disabled=""/,
    );
  });

  it("idle buttons are enabled with their labels", () => {
    const html = renderToStaticMarkup(
      <CreateLobbyButtonView pending={false} error={null} labels={labels} errors={errors} />,
    );
    expect(html).toContain(labels.createPrivateRace);
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain("disabled");
  });
});

// Contract of #367 C2: the practice entry, the secondary recipe (7.1) under CREATE PRIVATE RACE.
describe("practice entry (#367 C2)", () => {
  const practice = (props: {
    pending?: boolean;
    error?: EntryError | null;
    lang?: "en" | "fr";
  }) => {
    const m = props.lang === "fr" ? fr : en;
    return renderToStaticMarkup(
      <PracticeButtonView
        pending={props.pending ?? false}
        error={props.error ?? null}
        labels={m.landing.entries}
        errors={m.landing.errors}
      />,
    );
  };

  it("reads the catalog in both languages, idle and enabled", () => {
    expect(en.landing.entries).toEqual({
      practise: "PRACTISE VS BOTS",
      practising: "OPENING YOUR DESK…",
    });
    expect(fr.landing.entries).toEqual({
      practise: "S'ENTRAÎNER CONTRE LES BOTS",
      practising: "OUVERTURE DU BUREAU…",
    });
    for (const lang of ["en", "fr"] as const) {
      const html = practice({ lang });
      expect(html).toContain(
        (lang === "fr" ? fr : en).landing.entries.practise.replace("'", "&#x27;"),
      );
      expect(html).not.toContain("aria-busy");
      expect(html).not.toContain("disabled");
    }
  });

  it("pending reads the pending copy, aria-busy and disabled", () => {
    const html = practice({ pending: true });
    expect(html).toContain(en.landing.entries.practising);
    expect(html).not.toContain(en.landing.entries.practise);
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-busy="true"|<button[^>]*aria-busy="true"[^>]*disabled=""/,
    );
  });

  it("uses the secondary recipe of CREATE PRIVATE RACE, at least 44px tall", () => {
    const create = renderToStaticMarkup(
      <CreateLobbyButtonView pending={false} error={null} labels={labels} errors={errors} />,
    );
    const cls = (html: string) => /<button[^>]*class="([^"]+)"/.exec(html)![1];
    expect(cls(practice({}))).toBe(cls(create));
    const css = readFileSync(
      path.join(process.cwd(), "src/features/lobby/components/lobby-entry.module.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(/\.secondary \{([^}]*)\}/.exec(css)![1]).toMatch(/min-height: 44px;/);
  });

  it("navigates the host to the practice lobby", async () => {
    vi.mocked(createPracticeLobby).mockResolvedValue({ ok: true, code: "KGB-4821" as never });
    const navigate = vi.fn();
    expect(await makePracticeAction(navigate)()).toEqual({ error: null });
    expect(createPracticeLobby).toHaveBeenCalledWith();
    expect(navigate).toHaveBeenCalledWith("/lobby/KGB-4821");
  });

  it("a failure shows the inline error line of the other entries", async () => {
    vi.mocked(createPracticeLobby).mockResolvedValue({
      ok: false,
      error: "race-server-unavailable",
    });
    expect(await makePracticeAction(vi.fn())()).toEqual({ error: "race-server-unavailable" });
    vi.mocked(createPracticeLobby).mockRejectedValue(new Error("boom: secret"));
    const state = await makePracticeAction(vi.fn())();
    expect(state).toEqual({ error: "generic" });
    const html = practice({ error: "race-server-unavailable" });
    expect(html).toContain('role="alert"');
    expect(html).toContain(errors.prefix);
    expect(html).toContain(errors.unavailable);
  });
});
