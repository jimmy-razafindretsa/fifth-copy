import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { hasWebGL2, medalView, PodiumMedal } from "./podium-medal";

// Contract of #300 C4: the medal mounts through EmbedFrame only near the viewport (the server markup is
// an idle frame with no src), takes its variant from the URL flag and the bridge, and without WebGL2 the
// slot shows the gold HERO OF PAPERWORK stamp. The live path is checked in e2e/results/podium.spec.ts.
const props = { title: "The silver medal, in 3D", fallback: "HERO OF PAPERWORK" } as const;

describe("PodiumMedal (#300 C4)", () => {
  it("renders an idle EmbedFrame on the server: no src before it comes near the viewport", () => {
    const html = renderToStaticMarkup(<PodiumMedal variant="silver" {...props} />);
    expect(html).toContain('data-medal-view="frame"');
    expect(html).toContain('data-embed="idle"');
    expect(html).toContain('title="The silver medal, in 3D"');
    expect(html).not.toMatch(/<iframe[^>]* src=/);
  });

  it("the frame's URL carries the variant and the embed flag", () => {
    const source = readFileSync(path.join(__dirname, "podium-medal.tsx"), "utf8");
    expect(source).toContain("src={medalEmbedSrc(variant)}");
    expect(source).toContain("post(medalVariantMessage(variant))");
    expect(source).toContain("post(motionMessage(reduce))");
  });

  it("probes WebGL2 through getContext; a stubbed null or a throw means no WebGL", () => {
    const getContext = vi.fn(() => null);
    expect(hasWebGL2(() => ({ getContext }))).toBe(false);
    expect(getContext).toHaveBeenCalledWith("webgl2");
    expect(hasWebGL2(() => ({ getContext: () => ({}) }))).toBe(true);
    expect(
      hasWebGL2(() => ({
        getContext: () => {
          throw new Error("no GPU");
        },
      })),
    ).toBe(false);
  });

  it("without WebGL2 (or still) the slot is the gold stamp, never an empty frame", () => {
    expect(medalView({ still: false, webgl: false })).toBe("stamp");
    expect(medalView({ still: true, webgl: true })).toBe("stamp");
    expect(medalView({ still: false, webgl: true })).toBe("frame");
    expect(medalView({ still: false, webgl: null })).toBe("frame");
    const html = renderToStaticMarkup(<PodiumMedal variant="bronze" {...props} still />);
    expect(html).toContain('data-medal-view="stamp"');
    expect(html).toContain('data-stamp-tone="gold"');
    expect(html).toContain("HERO OF PAPERWORK");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain('role="status"');
  });
});
