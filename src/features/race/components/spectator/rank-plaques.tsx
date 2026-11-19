"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { Member } from "@fifth-copy/protocol";
import { useReducedMotion } from "@/components/ui";
import { fill } from "@/i18n/format";
import { useRaceStore } from "../../client/use-race-store";
import styles from "./rank-plaques.module.css";

/**
 * One desk's plaque point from the overview scene (#999 C4; race-3d's `SceneAnchor`, written out: `race`
 * never imports `race-3d`): `[desk, x, y]`, x and y in 0..1 of the frame.
 */
export type PlaqueAnchor = readonly [desk: number, x: number, y: number];

/** One rank plaque (#999 C4): the desk, its live rank (`null` before the first snapshot), its name. */
export type PlaqueRow = { desk: number; rank: number | null; name: string };

/** `race.projector` slices the plaques read. */
export type PlaqueLabels = { plaqueDesk: string; noPlace: string };

/** Every desk of the roster by desk number, with the server's live rank (ADR 0006). Pure. */
export function plaqueRows(
  members: readonly Pick<Member, "desk" | "name">[],
  ranks: readonly number[],
): PlaqueRow[] {
  const rankOf = new Map(ranks.map((desk, i) => [desk, i + 1]));
  return [...members]
    .sort((a, b) => a.desk - b.desk)
    .map((m) => ({ desk: m.desk, rank: rankOf.get(m.desk) ?? null, name: m.name }));
}

/**
 * The desks whose plaque flips (#999 C5): an overtake or a new leader, i.e. a desk whose rank number
 * went down since the last rows. A first rank (from none) is no overtake. Pure.
 */
export function overtakers(
  before: ReadonlyMap<number, number | null>,
  rows: readonly PlaqueRow[],
): number[] {
  return rows
    .filter((r) => {
      const was = before.get(r.desk);
      return r.rank !== null && was != null && r.rank < was;
    })
    .map((r) => r.desk);
}

/** The part of a plaque node `placePlaques` writes (an `HTMLElement` in the page). */
export type PlaqueNode = { style: { transform: string; visibility: string } };

/**
 * Puts each plaque at its anchor (#999 C4), through its node's style, never through React state (the
 * overview sends anchors every frame): the wrapper fills the layer, so a `translate` in % of itself is
 * a share of the frame. A plaque whose desk has no anchor (off screen, or no scene) is hidden.
 */
export function placePlaques(
  nodes: ReadonlyMap<number, PlaqueNode>,
  anchors: readonly PlaqueAnchor[],
): void {
  const at = new Map(anchors.map(([desk, x, y]) => [desk, [x, y] as const]));
  for (const [desk, node] of nodes) {
    const point = at.get(desk);
    if (!point) {
      if (node.style.visibility !== "hidden") node.style.visibility = "hidden";
      continue;
    }
    node.style.transform = `translate(${(point[0] * 100).toFixed(2)}%, ${(point[1] * 100).toFixed(2)}%)`;
    if (node.style.visibility !== "visible") node.style.visibility = "visible";
  }
}

type Sink = (anchors: readonly PlaqueAnchor[]) => void;
type Channel = { push: Sink; listen: (sink: Sink | null) => void };

const PlaqueChannel = createContext<Channel | null>(null);

/**
 * The anchors channel between the projector's stage (the scene, mounted by the route) and its plaque
 * layer (#999 C4): one ref, no state, so a frame's anchors never re-render React.
 */
export function PlaqueAnchorsProvider({ children }: { children: ReactNode }) {
  const sink = useRef<Sink | null>(null);
  const channel = useMemo<Channel>(
    () => ({
      push: (anchors) => sink.current?.(anchors),
      listen: (next) => {
        sink.current = next;
      },
    }),
    [],
  );
  return <PlaqueChannel.Provider value={channel}>{children}</PlaqueChannel.Provider>;
}

/** The stage's end of the channel: the scene's `onAnchors` (a no-op outside the provider). */
export function usePlaqueAnchors(): Sink {
  const channel = useContext(PlaqueChannel);
  return useCallback((anchors) => channel?.push(anchors), [channel]);
}

const two = (n: number) => String(n).padStart(2, "0");

/**
 * The rank plaques over the projector's overview (#999 C4, C5; bible 14.3 "Projector view", 10.3 "Lamp"):
 * one paper chip per desk above its typist's head, with the rank, `DESK 07` and the name; HTML only
 * (bible 9: no text in WebGL). Hidden until the scene says where the desk is; placed by `placePlaques`
 * on each anchors message. An overtake or a new leader flips the overtaker's chip once (`data-flip`, the
 * CSS reads `--motion-duration-slam`; its `data-flips` counts them); under reduced motion the rank just
 * changes. Decorative: the layer is `aria-hidden` (the top-10 sidebar is the accessible standings).
 */
export function RankPlaques({ rows, labels }: { rows: readonly PlaqueRow[]; labels: PlaqueLabels }) {
  const channel = useContext(PlaqueChannel);
  const reduce = useReducedMotion();
  const nodes = useRef(new Map<number, HTMLElement>());
  const chips = useRef(new Map<number, HTMLElement>());
  const last = useRef<readonly PlaqueAnchor[]>([]);
  const ranks = useRef(new Map<number, number | null>());

  useLayoutEffect(() => {
    const place: Sink = (anchors) => {
      last.current = anchors;
      placePlaques(nodes.current, anchors);
    };
    channel?.listen(place);
    return () => channel?.listen(null);
  }, [channel]);

  // a roster change mounts new plaques hidden: place them at once from the last anchors
  useLayoutEffect(() => {
    placePlaques(nodes.current, last.current);
    const flips = reduce ? [] : overtakers(ranks.current, rows);
    for (const desk of flips) {
      const chip = chips.current.get(desk);
      if (!chip) continue;
      // restart the one-shot flip
      chip.removeAttribute("data-flip");
      void chip.offsetWidth;
      chip.setAttribute("data-flip", "");
      chip.dataset.flips = String(Number(chip.dataset.flips ?? 0) + 1);
    }
    ranks.current = new Map(rows.map((r) => [r.desk, r.rank]));
  }, [rows, reduce]);

  return (
    <>
      {rows.map((r) => (
        <div
          key={r.desk}
          data-plaque={r.desk}
          className={styles.anchor}
          style={{ visibility: "hidden" }}
          ref={(node) => {
            if (node) nodes.current.set(r.desk, node);
            else nodes.current.delete(r.desk);
          }}
        >
          <div
            data-rank={r.rank ?? undefined}
            className={styles.plaque}
            ref={(node) => {
              if (node) chips.current.set(r.desk, node);
              else chips.current.delete(r.desk);
            }}
          >
            <span className={styles.rank}>{r.rank === null ? labels.noPlace : two(r.rank)}</span>
            <span className={styles.desk}>{fill(labels.plaqueDesk, { n: two(r.desk) })}</span>
            <span className={styles.name}>{r.name}</span>
          </div>
        </div>
      ))}
    </>
  );
}

/** The plaques over the spectator store (#999 C4): every desk of the roster with its live rank. */
export function RankPlaquesLive({ labels }: { labels: PlaqueLabels }) {
  const members = useRaceStore((s) => s.members);
  const ranks = useRaceStore((s) => s.ranks);
  const rows = useMemo(() => plaqueRows(members, ranks), [members, ranks]);
  return <RankPlaques rows={rows} labels={labels} />;
}
