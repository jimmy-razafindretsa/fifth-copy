import type { FeedView } from "./embed-messages";

/**
 * The live feed's recorded loops (bible 7.8, 14.1): one seamless clip per view, recorded from the bible's
 * Full Lobby scene by `scripts/record-live-feed.ts`, plus a poster still (frame 0 of AUTO). MP4 (H.264)
 * first for Safari, WebM (VP9) second; the browser takes the first type it can play.
 */
export const FEED_MEDIA_DIR = "/media/live-feed";
export const FEED_POSTER = `${FEED_MEDIA_DIR}/poster.webp`;

export const FEED_FORMATS = [
  { ext: "mp4", type: 'video/mp4; codecs="avc1.42E01E"' },
  { ext: "webm", type: 'video/webm; codecs="vp9"' },
] as const;

export type FeedSource = { src: string; type: string };

/** The `<source>` list of one view's loop, in preference order. */
export function feedSources(view: FeedView): FeedSource[] {
  return FEED_FORMATS.map(({ ext, type }) => ({ src: `${FEED_MEDIA_DIR}/${view}.${ext}`, type }));
}
