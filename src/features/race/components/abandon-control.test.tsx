import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hudLabelFixtures } from "../view/hud-labels";
import { ABANDON_CONFIRM_MS, AbandonControl, armAbandonCancel } from "./abandon-control";

// Contract of #560 C5 (markup, the cancel arming and the CSS; the live clicks, Escape and the 5 s clock
// on /design are checked in e2e/race/hud.spec.ts).
const EN = hudLabelFixtures.en.abandon;
const FR = hudLabelFixtures.fr.abandon;
const noop = () => {};
const html = (state: "idle" | "confirm" | "disabled", labels = EN) =>
  renderToStaticMarkup(
    <AbandonControl
      state={state}
      onAbandon={noop}
      onConfirm={noop}
      onCancel={noop}
      labels={labels}
    />,
  ).replace(/&amp;/g, "&");
const css = readFileSync(
  path.join(process.cwd(), "src/features/race/components/abandon-control.module.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const buttons = (markup: string) =>
  [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    attrs: m[1]!,
    text: m[2]!.replace(/<[^>]+>/g, ""),
  }));

/** A keydown event as the document dispatches it (Node has EventTarget but no KeyboardEvent). */
const key = (k: string) => Object.assign(new Event("keydown"), { key: k });

afterEach(() => {
  vi.useRealTimers();
});

describe("AbandonControl (#560 C5)", () => {
  it("idle: one secondary button ABANDON / ABANDONNER, collapsed", () => {
    const out = buttons(html("idle"));
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("ABANDON");
    expect(out[0]!.attrs).toContain('type="button"');
    expect(out[0]!.attrs).toContain('aria-expanded="false"');
    expect(out[0]!.attrs).toMatch(/class="[^"]*border-2 border-fg bg-transparent/);
    expect(buttons(html("idle", FR))[0]!.text).toBe("ABANDONNER");
  });

  it("confirm: the ink button CONFIRM · REASSIGN ME appears beside ABANDON, which it expands", () => {
    const out = buttons(html("confirm"));
    expect(out.map((b) => b.text)).toEqual(["ABANDON", "CONFIRM · REASSIGN ME"]);
    expect(out[0]!.attrs).toContain('aria-expanded="true"');
    const controls = /aria-controls="([^"]+)"/.exec(out[0]!.attrs)?.[1];
    expect(controls).toBeTruthy();
    expect(out[1]!.attrs).toContain(`id="${controls}"`);
    expect(out[1]!.attrs).toContain('type="button"');
    expect(buttons(html("confirm", FR))[1]!.text).toBe("CONFIRMER · ME RÉAFFECTER");
    // bible 7.1 ink button: ink ground, paper text, hover red
    expect(css).toMatch(
      /\.ink \{[^}]*background: var\(--color-fg\);[^}]*color: var\(--color-bg\);/,
    );
    expect(css).toMatch(/\.ink:hover \{[^}]*background: var\(--color-primary\);/);
  });

  it("disabled: the control stays visible but inert", () => {
    const out = buttons(html("disabled"));
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("ABANDON");
    expect(out[0]!.attrs).toContain('disabled=""');
    expect(html("disabled")).toMatch(/^<div[^>]*data-abandon="disabled"/);
  });

  it("hit targets are at least 44 px", () => {
    const [abandon, confirm] = buttons(html("confirm"));
    // the secondary Button: Tailwind min-h-11 (2.75rem = 44px); the ink button: its module rule
    expect(abandon!.attrs).toMatch(/\bmin-h-11\b/);
    expect(confirm!.attrs).toMatch(/class="_ink_/);
    expect(css).toMatch(/\.ink \{[^}]*min-height: 44px;/);
  });

  it("Escape cancels the confirm", () => {
    const target = new EventTarget();
    const onCancel = vi.fn();
    const dispose = armAbandonCancel(target, onCancel);
    target.dispatchEvent(key("a"));
    target.dispatchEvent(key("Enter"));
    expect(onCancel).not.toHaveBeenCalled();
    target.dispatchEvent(key("Escape"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("5 s without an answer cancels the confirm, once", () => {
    vi.useFakeTimers();
    expect(ABANDON_CONFIRM_MS).toBe(5000);
    const target = new EventTarget();
    const onCancel = vi.fn();
    const dispose = armAbandonCancel(target, onCancel);
    vi.advanceTimersByTime(4999);
    expect(onCancel).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(onCancel).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("disposing (leaving confirm) disarms both the key and the clock", () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const onCancel = vi.fn();
    armAbandonCancel(target, onCancel)();
    target.dispatchEvent(key("Escape"));
    vi.advanceTimersByTime(ABANDON_CONFIRM_MS * 2);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
