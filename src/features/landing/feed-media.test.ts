import { describe, expect, it } from "vitest";
import { FEED_VIEWS } from "./embed-messages";
import { FEED_POSTER, feedSources } from "./feed-media";

// #552 C1 C2: one loop per view, MP4 (H.264) first then WebM, and a poster still.
describe("feedSources", () => {
  it("lists the MP4 then the WebM of the view's loop", () => {
    expect(feedSources("pov")).toEqual([
      { src: "/media/live-feed/pov.mp4", type: 'video/mp4; codecs="avc1.42E01E"' },
      { src: "/media/live-feed/pov.webm", type: 'video/webm; codecs="vp9"' },
    ]);
  });

  it("gives every view its own files", () => {
    const srcs = FEED_VIEWS.flatMap((v) => feedSources(v).map((s) => s.src));
    expect(new Set(srcs).size).toBe(FEED_VIEWS.length * 2);
  });

  it("has a WebP poster", () => {
    expect(FEED_POSTER).toBe("/media/live-feed/poster.webp");
  });
});
