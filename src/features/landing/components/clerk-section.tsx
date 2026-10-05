"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { EmbedFrame, Star, useEmbedBridge } from "@/components/ui";
import {
  clerkMessageSchema,
  lookMessage,
  OUTFIT_CATEGORIES,
  reissueMessage,
  type Outfit,
  type OutfitCategory,
} from "../embed-messages";
import { EMBEDS } from "../links";
import shared from "./landing.module.css";
import styles from "./sections.module.css";

export type ClerkLabels = {
  stageTitle: string;
  stageHint: string;
  kicker: string;
  title: string;
  unassigned: string;
  deskRank: string;
  pending: string;
  reissue: string;
  locker: string;
  ladderLabel: string;
  ranks: readonly string[];
  categories: Record<OutfitCategory, string>;
  items: Record<OutfitCategory, Record<string, string>>;
};

type Props = {
  labels: ClerkLabels;
  /** The viewer's typist name with its honorific, or null before a guest exists. */
  name: string | null;
  lockerHref: string;
};

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/**
 * Your clerk (bible 14.1 item 5, 10.2, 15): the clerk embed follows the cursor anywhere on the page
 * (`fc-look`, throttled with rAF), a click or REISSUE UNIFORM hops into a new uniform (`fc-reissue`),
 * and every `fc-clerk` message fills the personnel file's issued-uniform rows.
 */
export function ClerkSection({ labels, name, lockerHref }: Props) {
  const [outfit, setOutfit] = useState<Outfit | null>(null);
  const onMessage = useCallback((message: { cfg: Outfit }) => setOutfit(message.cfg), []);
  const { ref, post } = useEmbedBridge(clerkMessageSchema, onMessage);

  useEffect(() => {
    let frame = 0;
    const move = (event: MouseEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height * 0.32;
        post(
          lookMessage(
            clamp((event.clientX - cx) / (window.innerWidth / 2)),
            clamp((event.clientY - cy) / (window.innerHeight / 2)),
          ),
        );
      });
    };
    window.addEventListener("mousemove", move);
    return () => {
      window.removeEventListener("mousemove", move);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [post, ref]);

  const itemName = (category: OutfitCategory) => {
    if (!outfit) return labels.pending;
    const id = outfit[category];
    return labels.items[category][id] ?? id;
  };

  return (
    <section className={styles.clerk} aria-labelledby="clerk-title">
      <div className={styles.stage}>
        <Star size={40} tone="red" spin={30} at={{ right: 28, top: 56, zIndex: 1 }} />
        <Star size={24} tone="gold" spin={22} at={{ right: 76, top: 104, zIndex: 1 }} />
        <Star size={54} tone="faintInk" spin={70} at={{ left: 24, bottom: 28, zIndex: 0 }} />
        <EmbedFrame
          ref={ref}
          src={EMBEDS.clerk}
          title={labels.stageTitle}
          className={styles.stageEmbed}
        />
        <div className={styles.stageHint}>{labels.stageHint}</div>
      </div>
      <div className={styles.file}>
        <div className={shared.kicker}>{labels.kicker}</div>
        <h2 id="clerk-title" className={cn(shared.h2, styles.fileTitle)}>
          {labels.title}
        </h2>
        <div className={styles.docket}>
          <div className={styles.docketHead}>
            <span className={styles.docketName}>{name ?? labels.unassigned}</span>
            <span className={styles.docketTag}>{labels.deskRank}</span>
          </div>
          <dl className={styles.docketRows} aria-busy={outfit ? undefined : true}>
            {OUTFIT_CATEGORIES.map((category) => (
              <div key={category} className={styles.docketRow}>
                <dt>{labels.categories[category]}</dt>
                <dd>{itemName(category)}</dd>
              </div>
            ))}
          </dl>
          <div className={styles.docketActions}>
            <button
              type="button"
              className={shared.inkButton}
              onClick={() => post(reissueMessage())}
            >
              {labels.reissue}
            </button>
            <a href={lockerHref} className={shared.secondary}>
              {labels.locker}
            </a>
          </div>
        </div>
        <div className={styles.ladder}>
          <div className={styles.ladderLabel}>{labels.ladderLabel}</div>
          <ol className={styles.ranks}>
            {labels.ranks.map((rank, i) => (
              <li
                key={rank}
                className={
                  i === 0
                    ? styles.rankCurrent
                    : i === labels.ranks.length - 1
                      ? styles.rankHero
                      : styles.rank
                }
                aria-current={i === 0 ? "step" : undefined}
              >
                {rank}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
