import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../actions/join-by-code", () => ({ joinByCode: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { joinByCode } = await import("../actions/join-by-code");
const { INVITE_TOKEN_RE } = await import("../invite-token");
const { en } = await import("@/i18n/en");
const { makeWatchAction, readWatchEntry, WATCH_TOKEN_RE, WatchEntryFormView } =
  await import("./watch-entry-form");

// Contract of #999 C15 (the entry half): the phone landing's watch entry takes a room code or a
// spectator link; a link opens its `/watch/<token>` page, a code the lobby (which a phone watches).
const TOKEN = "A".repeat(20) + "b_-" + "9".repeat(20);

describe("#999 C15 the phone watch entry", () => {
  beforeEach(() => vi.mocked(joinByCode).mockReset());

  it("reads a spectator token the way the server does", () => {
    expect(WATCH_TOKEN_RE.source).toBe(INVITE_TOKEN_RE.source);
  });

  it.each([
    [`https://fifth.example/watch/${TOKEN}`, { link: `/watch/${TOKEN}` }],
    [`  /watch/${TOKEN}?from=chat#x `, { link: `/watch/${TOKEN}` }],
    [TOKEN, { link: `/watch/${TOKEN}` }],
    ["kgb-4821", { code: "KGB-4821" }],
    ["KGB4821", { code: "KGB-4821" }],
    ["", null],
    ["https://fifth.example/watch/short", null],
    ["hello", null],
  ])("%j -> %j", (raw, expected) => {
    expect(readWatchEntry(raw)).toEqual(expected);
  });

  const form = (value: string) => {
    const data = new FormData();
    data.set("watch", value);
    return data;
  };

  it("a link goes to its watch page with no request; a code joins and opens the lobby", async () => {
    const navigate = vi.fn();
    const watch = makeWatchAction(navigate);
    expect(await watch({ error: null }, form(`/watch/${TOKEN}`))).toEqual({ error: null });
    expect(joinByCode).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenLastCalledWith(`/watch/${TOKEN}`);
    vi.mocked(joinByCode).mockResolvedValue({ ok: true, code: "KGB-4821" } as never);
    expect(await watch({ error: null }, form("kgb-4821"))).toEqual({ error: null });
    expect(joinByCode).toHaveBeenCalledWith({ code: "KGB-4821" });
    expect(navigate).toHaveBeenLastCalledWith("/lobby/KGB-4821");
  });

  it("anything else is refused before a request; refusals read as the code join's", async () => {
    const navigate = vi.fn();
    const watch = makeWatchAction(navigate);
    expect(await watch({ error: null }, form("hello"))).toEqual({ error: "invalid-watch" });
    vi.mocked(joinByCode).mockResolvedValue({ ok: false, error: "rate-limited" } as never);
    expect(await watch({ error: null }, form("KGB-4821"))).toEqual({ error: "generic" });
    vi.mocked(joinByCode).mockResolvedValue({ ok: false, error: "not-found" } as never);
    expect(await watch({ error: null }, form("KGB-4821"))).toEqual({ error: "not-found" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("renders the 7.2 code group: label, field, WATCH; its error line names the link", () => {
    const html = renderToStaticMarkup(
      createElement(WatchEntryFormView, {
        pending: false,
        error: "invalid-watch",
        labels: en.landing.watch,
        errors: en.landing.errors,
        ids: { input: "w", error: "e" },
      }),
    );
    expect(html).toContain('aria-label="Watch a race"');
    expect(html).toContain("WATCH WITH CODE OR LINK");
    expect(html).toContain("WATCH →");
    expect(html).toContain(en.landing.watch.invalid);
    expect(html).toContain('aria-describedby="e"');
  });
});
