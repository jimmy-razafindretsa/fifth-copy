"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { fill } from "@/i18n/format";
import { FEED_VIEWS, setViewMessage, type FeedView } from "../embed-messages";
import { timecode } from "../feed";
import { EMBEDS } from "../links";
import { EmbedFrame } from "./embed-frame";
import styles from "./hero.module.css";
import shared from "./landing.module.css";
import { useEmbedBridge } from "./use-embed-bridge";

export type FeedLabels = {
  frameTitle: string;
  live: string;
  room: string;
  cam: string;
  caption: string;
  viewLabel: string;
  views: Record<FeedView, string>;
  stampRoom: string;
  stampSeats: string;
};

type Props = { labels: FeedLabels; roomNumber: number; elapsedSeconds: number };

/**
 * Live feed of the ring room (bible 7.8, 14.1 item 2): parallelogram frame, scanlines, a blinking LIVE
 * badge, the room chip with a ticking timecode, CAM 02, the caption and the FREE VIEW | FIRST PERSON | AUTO
 * toggle driving the embed (bible 15 `fc-setview`). The stamp over the frame bobs.
 */
export function LiveFeed({ labels, roomNumber, elapsedSeconds }: Props) {
  const [elapsed, setElapsed] = useState(elapsedSeconds);
  const [view, setView] = useState<FeedView>("auto");
  const { ref, post } = useEmbedBridge();

  useEffect(() => {
    const tick = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const pick = useCallback(
    (next: FeedView) => {
      setView(next);
      post(setViewMessage(next));
    },
    [post],
  );

  return (
    <div className={styles.aside}>
      <div className={styles.frame}>
        <EmbedFrame
          ref={ref}
          src={EMBEDS.lobby}
          title={labels.frameTitle}
          className={styles.feedEmbed}
          decorative
        />
        <div className={styles.scanlines} aria-hidden="true" />
        <div className={styles.chips}>
          <div className={styles.live}>
            <span className={styles.liveDot} aria-hidden="true" />
            {labels.live}
          </div>
          <div className={styles.roomChip}>
            {fill(labels.room, { n: roomNumber, time: timecode(elapsed) })}
          </div>
        </div>
        <div className={styles.cam}>{labels.cam}</div>
      </div>
      <div className={styles.captionRow}>
        <span>{fill(labels.caption, { n: roomNumber })}</span>
        <div role="group" aria-label={labels.viewLabel} className={shared.segmented}>
          {FEED_VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              className={shared.segment}
              aria-pressed={view === option}
              onClick={() => pick(option)}
            >
              {labels.views[option]}
            </button>
          ))}
        </div>
      </div>
      <div className={cn(shared.stamp, styles.roomStamp)} aria-hidden="true">
        {fill(labels.stampRoom, { n: roomNumber })}
        <br />
        {labels.stampSeats}
      </div>
    </div>
  );
}
