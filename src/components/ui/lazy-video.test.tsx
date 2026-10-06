import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LazyVideo as FromIndex, NEAR_VIEWPORT } from "@/components/ui";
import { LazyVideo } from "./lazy-video";

const SOURCES = [
  { src: "/media/a.mp4", type: "video/mp4" },
  { src: "/media/a.webm", type: "video/webm" },
];

// #552 C1 C2: the server renders the poster only; sources come near the viewport (e2e/landing.spec.ts).
describe("LazyVideo", () => {
  const html = renderToStaticMarkup(<LazyVideo poster="/media/p.webp" sources={SOURCES} />);

  it("is a decorative looping inline video with a poster and no controls", () => {
    expect(html).toMatch(/^<video [^>]*poster="\/media\/p.webp"/);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("loop");
    expect(html).toContain("playsInline");
    expect(html).not.toContain("controls");
    expect(html).not.toContain("autoPlay");
  });

  it("downloads nothing before it comes near the viewport", () => {
    expect(html).not.toContain("<source");
    expect(html).toContain('preload="none"');
    expect(html).toContain('data-feed="idle"');
  });

  it("is exported with the shared near-viewport margin", () => {
    expect(FromIndex).toBe(LazyVideo);
    expect(NEAR_VIEWPORT).toBe("320px");
  });
});
