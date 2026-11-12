"use client";

import { useEffect, useRef, useState } from "react";
import { useRaceStore } from "../client/use-race-store";
import {
  announcementText,
  announcementsFor,
  createAnnounceQueue,
  placeDueIn,
  selectAnnounceFinalPlace,
  selectAnnounceFinalTotal,
  selectAnnounceOver,
  selectAnnouncePlace,
  selectAnnounceStamp,
  selectAnnounceTotal,
  selectAnnounceTyping,
  selectAnnounceWpm,
  type AnnounceLine,
  type AnnounceView,
  type AnnouncerLabels,
  type PlaceMemo,
} from "../view/announcements";
import type { CountdownStep } from "./countdown";
import docket from "./hud-docket.module.css";

/**
 * The race announcer (#242, ARCHITECTURE 10, bible 14.3): the seat's one visually hidden polite
 * `status` region, atomic. It turns store changes and the countdown step into short sentences
 * (`announcementsFor`) at a bounded rate (`createAnnounceQueue`): 3, 2, 1, GO (#214), your place, the
 * overtake lines (#232), your finish and its stamp's line (#240), the race over. It never takes the
 * focus and never reads the race text. The notices (#233), the IMMUNE row (#236) and the lost line keep
 * their own regions; nothing here repeats them.
 */
export function RaceAnnouncer({
  step,
  labels,
}: {
  step: CountdownStep | null;
  labels: AnnouncerLabels;
}) {
  const phase = useRaceStore((s) => s.phase);
  const stamp = useRaceStore(selectAnnounceStamp);
  const wpm = useRaceStore(selectAnnounceWpm);
  const place = useRaceStore(selectAnnouncePlace);
  const total = useRaceStore(selectAnnounceTotal);
  const isTyping = useRaceStore(selectAnnounceTyping);
  const isOver = useRaceStore(selectAnnounceOver);
  const finalPlace = useRaceStore(selectAnnounceFinalPlace);
  const finalTotal = useRaceStore(selectAnnounceFinalTotal);
  const [line, setLine] = useState<AnnounceLine | null>(null);
  const [recheck, setRecheck] = useState(0);
  const queue = useRef<ReturnType<typeof createAnnounceQueue> | null>(null);
  const prev = useRef<AnnounceView | null>(null);
  const memo = useRef<PlaceMemo>(null);

  useEffect(() => {
    const own = createAnnounceQueue(setLine);
    queue.current = own;
    return () => {
      own.dispose();
      if (queue.current === own) queue.current = null;
    };
  }, []);

  useEffect(() => {
    const next: AnnounceView = {
      at: Date.now(),
      phase,
      step,
      stamp,
      wpm,
      place,
      total,
      typing: isTyping,
      over: isOver ? { place: finalPlace, total: finalTotal } : null,
    };
    const out = announcementsFor(prev.current, next, memo.current);
    prev.current = next;
    memo.current = out.memo;
    if (out.said.length > 0) queue.current?.push(out.said.map((a) => announcementText(a, labels)));
    const due = placeDueIn(next, out.memo);
    if (due === null) return;
    const handle = setTimeout(() => setRecheck((n) => n + 1), due);
    return () => clearTimeout(handle);
  }, [
    phase,
    step,
    stamp,
    wpm,
    place,
    total,
    isTyping,
    isOver,
    finalPlace,
    finalTotal,
    labels,
    recheck,
  ]);

  return (
    <p role="status" aria-live="polite" aria-atomic="true" data-announcer className={docket.srOnly}>
      {/* the line's own node (a new one per line, so a repeated sentence is re-read) is a 1px box too */}
      {line ? (
        <span key={line.id} className={docket.srOnly}>
          {line.text}
        </span>
      ) : null}
    </p>
  );
}
