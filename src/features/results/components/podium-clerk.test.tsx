import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { hasWebGL2 } from "@/components/ui";
import { clerkMessages, clerkView, PodiumClerk } from "./podium-clerk";

// Contract of #688 C3 (after #300 C4): the plinth clerk mounts through EmbedFrame only near the viewport
// and once the stagger allows it (`mount`), takes its variant and outfit from the URL flags and the bridge,
// and without WebGL2 (or still) the slot shows the gold HERO OF PAPERWORK stamp. The live path is checked
// in e2e/results/podium.spec.ts.
const outfit = {
  hair: "quiff",
  glasses: "monocle",
  hat: "beret",
  clothes: "jacket",
  face: "beard",
  hairCol: "#A4552A",
};
const props = { title: "The silver medal, in 3D", fallback: "HERO OF PAPERWORK", outfit } as const;
const source = readFileSync(path.join(__dirname, "podium-clerk.tsx"), "utf8");

/** The view a stubbed `getContext` leads to (the probe the leaf runs once). */
const viewWith = (getContext: () => unknown, still = false) =>
  clerkView({ still, webgl: hasWebGL2(() => ({ getContext })) });

describe("PodiumClerk (#688 C3)", () => {
  it("WebGL2 present: the frame; getContext null or throwing: the stamp; still: the stamp", () => {
    const getContext = vi.fn(() => ({}));
    expect(viewWith(getContext)).toBe("frame");
    expect(getContext).toHaveBeenCalledWith("webgl2");
    expect(viewWith(() => null)).toBe("stamp");
    expect(
      viewWith(() => {
        throw new Error("no GPU");
      }),
    ).toBe("stamp");
    expect(viewWith(() => ({}), true)).toBe("stamp");
    // while hydrating (no answer yet) the frame stays, idle
    expect(clerkView({ still: false, webgl: null })).toBe("frame");
  });

  it("the frame view: an idle EmbedFrame on the server, no src before it may mount", () => {
    for (const mount of [true, false]) {
      const html = renderToStaticMarkup(<PodiumClerk variant="silver" {...props} mount={mount} />);
      expect(html).toContain('data-medal-view="frame"');
      expect(html).toContain('data-medal="silver"');
      expect(html).toContain('data-embed="idle"');
      expect(html).toContain('title="The silver medal, in 3D"');
      expect(html).not.toMatch(/<iframe[^>]* src=/);
    }
  });

  it("the held view: mount false keeps the frame idle even near the viewport", () => {
    expect(source).toContain("hold={!mount}");
    expect(source).toContain('if (view !== "frame" || !mount || !frame) return;');
    const frame = readFileSync(
      path.join(process.cwd(), "src/components/ui/embed-frame.tsx"),
      "utf8",
    );
    expect(frame).toContain("const mounted = near && !hold;");
    expect(frame).toContain("src={mounted ? src : undefined}");
  });

  it("the stamp view: the gold sm HERO OF PAPERWORK stamp, never an empty frame", () => {
    const html = renderToStaticMarkup(<PodiumClerk variant="bronze" {...props} still />);
    expect(html).toContain('data-medal-view="stamp"');
    expect(html).toContain('data-stamp-tone="gold"');
    expect(html).toContain("HERO OF PAPERWORK");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain('role="status"');
  });

  it("the frame's URL carries the embed flag, the variant and the outfit", () => {
    expect(source).toContain("src={podiumClerkSrc(variant, outfit)}");
  });

  it("on load it posts fc-medal-variant, fc-setcfg and fc-motion; onReady on the first fc-clerk", () => {
    expect(clerkMessages("gold", outfit, true)).toEqual([
      { type: "fc-medal-variant", variant: "gold" },
      { type: "fc-setcfg", cfg: outfit },
      { type: "fc-motion", reduce: true },
    ]);
    expect(source).toContain("clerkMessages(variant, outfit, reduce).forEach(post)");
    expect(source).toContain('frame.addEventListener("load", send)');
    expect(source).toContain("useEmbedBridge(parseClerkReady, onReady)");
    // the stamp needs no boot: the next plinth may mount at once
    expect(source).toContain('if (view === "stamp") onReady?.();');
  });
});
