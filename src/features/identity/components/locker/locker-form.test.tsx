import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import {
  DEFAULT_OUTFIT,
  initialLockerState,
  isDirty,
  lockerReducer,
  randomOutfit,
  setCfgMessage,
} from "../../clerk/locker-state";
import { OUTFIT_CATALOGUE, OUTFIT_CATEGORIES, parseOutfit, type Outfit } from "../../clerk/outfit";
import { LockerForm, type LockerFormProps } from "./locker-form";
import { saveClerkOutfit } from "../../actions/save-clerk-outfit";

vi.mock("@/server/auth", () => ({ getViewer: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/server/limiter", () => ({ limit: vi.fn(async () => ({ ok: true })) }));
const update = vi.fn();
vi.mock("@/server/db", () => ({ db: { user: { update: (...a: unknown[]) => update(...a) } } }));

// #943 C25, C28: the locker form's state, the message it posts, its markup, and a refused save.
const SAVED: Outfit = { ...DEFAULT_OUTFIT, hat: "kepka", glasses: "square" };

describe("locker state (C25)", () => {
  it("choosing marks the form dirty; undo restores the saved outfit", () => {
    let s = initialLockerState(SAVED);
    expect(isDirty(s)).toBe(false);
    s = lockerReducer(s, { type: "choose", slot: "hat", id: "beret" });
    expect(s.outfit.hat).toBe("beret");
    expect(isDirty(s)).toBe(true);
    s = lockerReducer(s, { type: "undo" });
    expect(s.outfit).toEqual(SAVED);
    expect(isDirty(s)).toBe(false);
  });

  it("an id outside the catalogue is ignored", () => {
    const s = initialLockerState(SAVED);
    expect(lockerReducer(s, { type: "choose", slot: "hat", id: "crown" })).toBe(s);
  });

  it("filing then filed puts the outfit on file (clean), then settles", () => {
    let s = lockerReducer(initialLockerState(null), { type: "choose", slot: "face", id: "beard" });
    s = lockerReducer(s, { type: "filing" });
    expect(s.status).toBe("filing");
    s = lockerReducer(s, { type: "filed" });
    expect(s.status).toBe("filed");
    expect(isDirty(s)).toBe(false);
    expect(s.saved.face).toBe("beard");
    expect(lockerReducer(s, { type: "settle" }).status).toBe("idle");
  });

  it("a refused save keeps the changes unsigned", () => {
    let s = lockerReducer(initialLockerState(SAVED), { type: "choose", slot: "hat", id: "none" });
    s = lockerReducer(s, { type: "refused" });
    expect(s.status).toBe("refused");
    expect(isDirty(s)).toBe(true);
  });

  it("RANDOM ISSUE picks a valid outfit", () => {
    let seed = 0.13;
    const random = () => (seed = (seed * 9301 + 0.49297) % 1);
    for (let i = 0; i < 20; i++) expect(parseOutfit(randomOutfit(random))).not.toBeNull();
    const s = lockerReducer(initialLockerState(SAVED), { type: "random", random: () => 0 });
    expect(s.outfit.hair).toBe(OUTFIT_CATALOGUE.hair[0]);
  });

  it("fc-setcfg carries the whole outfit (bible 15)", () => {
    expect(setCfgMessage(SAVED)).toEqual({ type: "fc-setcfg", cfg: SAVED });
    expect(Object.keys(setCfgMessage(SAVED).cfg).sort()).toEqual(
      [...OUTFIT_CATEGORIES, "hairCol"].sort(),
    );
  });
});

describe("saveClerkOutfit refuses an invalid outfit (C25)", () => {
  it("an id outside the catalogue saves nothing", async () => {
    update.mockReset();
    await expect(saveClerkOutfit({ ...SAVED, hat: "crown" })).resolves.toEqual({
      saved: false,
      reason: "invalid",
    });
    expect(update).not.toHaveBeenCalled();
  });
});

const labels = {
  ...en.locker,
  categories: en.landing.clerk.categories,
  items: en.landing.clerk.items,
};
const props = (over: Partial<LockerFormProps> = {}): LockerFormProps => ({
  labels,
  name: "Lynx-785",
  saved: SAVED,
  clerkSrc: "/3d/clerk.html?locker=1",
  picture: <svg />,
  unseen: ["glasses:square", "hat:kepka"],
  save: async () => ({ saved: true }),
  specimen: {},
  ...over,
});

describe("LockerForm markup (C24, C26, C28)", () => {
  it("one h1, five tabs with the hair tab selected, one card per catalogue id, no lock", () => {
    const html = renderToStaticMarkup(<LockerForm {...props()} />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(">DRESS YOUR CLERK</h1>");
    expect(html.match(/role="tab"/g)).toHaveLength(5);
    expect(html).toMatch(/aria-selected="true"[^>]*>HAIR/);
    expect(html.match(/data-item="hair:/g)).toHaveLength(OUTFIT_CATALOGUE.hair.length);
    expect(html).not.toContain("data-locked");
    expect(html).toContain('data-stage-view="picture"');
  });

  it("clean: ON FILE; the saved item is equipped (ISSUED)", () => {
    const html = renderToStaticMarkup(<LockerForm {...props()} />);
    expect(html).toContain('data-dirty="false"');
    expect(html).toContain(">ON FILE<");
    expect(html).toMatch(/data-item="hair:side" data-state="equipped"[^>]*>.*?ISSUED/);
  });

  it("dirty: SIGN & FILE and the UNSIGNED CHANGES bar", () => {
    const html = renderToStaticMarkup(
      <LockerForm {...props({ specimen: { outfit: { ...SAVED, hair: "buzz" } } })} />,
    );
    expect(html).toContain('data-dirty="true"');
    expect(html).toContain(">SIGN &amp; FILE<");
    expect(html).toContain("UNSIGNED CHANGES");
  });

  it("C28 unseen NEW items carry the NEW tag and their tab the red dot; seen ones none", () => {
    const glasses = renderToStaticMarkup(
      <LockerForm {...props({ specimen: { tab: "glasses" } })} />,
    );
    expect(glasses).toMatch(/data-item="glasses:square"[^>]*data-new="true"/);
    expect(glasses.match(/>NEW</g)).toHaveLength(1);
    const seen = renderToStaticMarkup(
      <LockerForm {...props({ unseen: [], specimen: { tab: "glasses" } })} />,
    );
    expect(seen).not.toContain(">NEW<");
  });

  it("a refused save shows the 7.4 inline error line", () => {
    const html = renderToStaticMarkup(
      <LockerForm {...props({ specimen: { status: "refused" } })} />,
    );
    expect(html).toMatch(
      /role="alert"[^>]*><span[^>]*>RETURNED ·<\/span> That uniform was not filed/,
    );
  });
});
