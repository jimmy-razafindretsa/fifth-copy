"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  EmbedFrame,
  Stamp,
  stageView,
  useEmbedBridge,
  useReducedMotion,
  useWebGL2,
} from "@/components/ui";
import type { Messages } from "@/i18n/en";
import { cn } from "@/lib/cn";
import type { SaveClerkOutfit } from "../../actions/save-clerk-outfit";
import {
  initialLockerState,
  isDirty,
  lockerReducer,
  type LockerState,
  setCfgMessage,
} from "../../clerk/locker-state";
import { itemKey, type NewItemId } from "../../clerk/new-items";
import {
  OUTFIT_CATALOGUE,
  OUTFIT_CATEGORIES,
  type Outfit,
  type OutfitCategory,
} from "../../clerk/outfit";
import styles from "./locker.module.css";

export type LockerLabels = Messages["locker"] & {
  categories: Record<OutfitCategory, string>;
  items: Record<OutfitCategory, Record<string, string>>;
};

export type LockerFormProps = {
  labels: LockerLabels;
  /** The name tag: the viewer's typist name. */
  name: string;
  saved: Outfit | null;
  /** `/3d/clerk.html?locker=1&cfg=…` (landing `clerkEmbedSrc`, passed by the route). */
  clerkSrc: string;
  /** The viewer's portrait, without WebGL2 or under reduced motion. */
  picture: ReactNode;
  /** The `NEW` items not yet seen when the page loaded (kept for this visit). */
  unseen: readonly NewItemId[];
  /** identity's `saveClerkOutfit` (zod-validated, authorized inside). */
  save: SaveClerkOutfit;
  /** Marks the `NEW` items seen (cookie), once on mount. */
  markSeen?: () => Promise<void>;
  /** `/design` specimens: a fixed state, no embed, no side effects. */
  specimen?: Partial<LockerState>;
  /** `/design` specimens: unique ids and an h2 under the page's h1. */
  idPrefix?: string;
  headingLevel?: 1 | 2;
};

const CODES: Record<OutfitCategory, string> = {
  hair: "H",
  glasses: "G",
  hat: "T",
  clothes: "C",
  face: "F",
};

const FILED_MS = 1800;

/**
 * The locker (#943 part D, bible 14.2 and "Locker in the app", reference `Fifth Copy Locker.dc.html`):
 * the steel door with the clerk (3D after hydration, else the portrait), and FORM 5-C with the category
 * tabs, one radio group of item cards per category, the hair-colour row, and SIGN & FILE.
 */
export function LockerForm({
  labels,
  name,
  saved,
  clerkSrc,
  picture,
  unseen,
  save,
  markSeen,
  specimen,
  idPrefix = "locker",
  headingLevel = 1,
}: LockerFormProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const [state, dispatch] = useReducer(lockerReducer, saved, (s) => ({
    ...initialLockerState(s),
    ...specimen,
  }));
  // the visit's NEW tags: the action's cookie write re-renders the route, the tags stay (#943 C29)
  const [fresh] = useState(() => new Set<string>(unseen));
  const webgl = useWebGL2();
  const reducedMotion = useReducedMotion();
  const view = stageView({ clerkSrc, still: specimen !== undefined, webgl, reducedMotion });
  const { ref, post } = useEmbedBridge();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const dirty = isDirty(state);

  // once per visit: the action's cookie write re-renders the route with a new action reference
  const marked = useRef(false);
  useEffect(() => {
    if (specimen || marked.current) return;
    marked.current = true;
    void markSeen?.().catch(() => undefined);
  }, [markSeen, specimen]);

  // the clerk wears what the form shows: on every change, and when the frame (re)loads
  useEffect(() => {
    post(setCfgMessage(state.outfit));
  }, [post, state.outfit]);
  const outfitRef = useRef(state.outfit);
  useEffect(() => {
    outfitRef.current = state.outfit;
  }, [state.outfit]);
  const frameRef = useCallback(
    (node: HTMLIFrameElement | null) => {
      ref.current = node;
      node?.addEventListener("load", () => post(setCfgMessage(outfitRef.current)));
    },
    [post, ref],
  );

  useEffect(() => {
    if (state.status !== "filed") return;
    const timer = setTimeout(() => dispatch({ type: "settle" }), FILED_MS);
    return () => clearTimeout(timer);
  }, [state.status]);

  const file = async () => {
    if (!dirty || state.status === "filing") return;
    dispatch({ type: "filing" });
    try {
      const result = await save(state.outfit);
      dispatch({ type: result.saved ? "filed" : "refused" });
    } catch {
      dispatch({ type: "refused" });
    }
  };

  const tabIndex = OUTFIT_CATEGORIES.indexOf(state.tab);
  const onTabKey = (event: KeyboardEvent) => {
    const n = OUTFIT_CATEGORIES.length;
    const to =
      event.key === "ArrowRight"
        ? (tabIndex + 1) % n
        : event.key === "ArrowLeft"
          ? (tabIndex + n - 1) % n
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? n - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    dispatch({ type: "tab", tab: OUTFIT_CATEGORIES[to]! });
    tabs.current[to]?.focus();
  };

  const ids = OUTFIT_CATALOGUE[state.tab];
  const chosen = ids.indexOf(state.outfit[state.tab]);
  const onCardKey = (event: KeyboardEvent) => {
    const n = ids.length;
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const to = (chosen + step + n) % n;
    dispatch({ type: "choose", slot: state.tab, id: ids[to]! });
    cards.current[to]?.focus();
  };

  const swatches = useRef<(HTMLButtonElement | null)[]>([]);
  const colourIds = OUTFIT_CATALOGUE.hairCol;
  const onSwatchKey = (event: KeyboardEvent) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const n = colourIds.length;
    const to = (Math.max(0, colourIds.indexOf(state.outfit.hairCol)) + step + n) % n;
    dispatch({ type: "choose", slot: "hairCol", id: colourIds[to]! });
    swatches.current[to]?.focus();
  };

  const tabHasNew = (category: OutfitCategory) =>
    OUTFIT_CATALOGUE[category].some((id) => fresh.has(itemKey(category, id)));

  return (
    <div className={styles.locker} data-locker data-dirty={dirty ? "true" : "false"}>
      <section className={styles.doorSide} aria-label={labels.stageTitle}>
        <div className={styles.door}>
          <div className={styles.doorTop}>
            <div className={styles.vents} aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className={styles.vent} />
              ))}
            </div>
            <div className={styles.nameTag}>
              <span className={styles.nameTagLabel}>{labels.lockerNo}</span>
              <span className={styles.nameTagName}>{name}</span>
            </div>
          </div>
          <div className={styles.interior} data-stage-view={view}>
            {view === "clerk" ? (
              <EmbedFrame
                ref={frameRef}
                src={clerkSrc}
                title={labels.stageTitle}
                className={styles.clerkFrame}
              />
            ) : (
              <div className={styles.picture} aria-hidden="true">
                {picture}
              </div>
            )}
            <div className={styles.rail} aria-hidden="true" />
            <div className={styles.hook} aria-hidden="true" />
            {state.status === "filed" ? (
              <div className={styles.filed}>
                <Stamp lines={[labels.filed]} size="lg" rotation={-6} />
              </div>
            ) : null}
          </div>
          <div className={styles.doorFoot}>
            <span className={styles.dial} aria-hidden="true" />
            <span className={styles.doorHint}>{labels.stageHint}</span>
          </div>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => dispatch({ type: "random", random: Math.random })}
            data-random
          >
            <span aria-hidden="true" className={styles.dice}>
              ⚄
            </span>
            {labels.random}
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => dispatch({ type: "undo" })}
            data-undo
          >
            {labels.undo}
          </button>
          <button
            type="button"
            className={cn(styles.sign, dirty && styles.signDirty)}
            onClick={file}
            aria-disabled={!dirty || state.status === "filing" ? "true" : undefined}
            aria-busy={state.status === "filing" ? "true" : undefined}
            data-sign
          >
            {state.status === "filing" ? labels.filing : dirty ? labels.sign : labels.onFile}
          </button>
        </div>
        {state.status === "refused" ? (
          <p role="alert" className={styles.errorLine}>
            <span className={styles.errorPrefix}>{labels.errorPrefix}</span> {labels.refused}
          </p>
        ) : null}
      </section>

      <section className={styles.form} aria-labelledby={`${idPrefix}-title`}>
        <div className={styles.formHead}>
          <span className={styles.kicker}>{labels.kicker}</span>
          <Heading id={`${idPrefix}-title`} className={styles.title}>
            {labels.title}
          </Heading>
        </div>
        <div
          role="tablist"
          aria-label={labels.tabsLabel}
          className={styles.tabs}
          onKeyDown={onTabKey}
        >
          {OUTFIT_CATEGORIES.map((category, i) => {
            const active = category === state.tab;
            return (
              <button
                key={category}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${idPrefix}-tab-${category}`}
                aria-selected={active}
                aria-controls={`${idPrefix}-panel`}
                tabIndex={active ? 0 : -1}
                className={styles.tab}
                onClick={() => dispatch({ type: "tab", tab: category })}
              >
                {labels.categories[category]}
                {tabHasNew(category) ? <span className={styles.newDot} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
        <div
          role="tabpanel"
          id={`${idPrefix}-panel`}
          aria-labelledby={`${idPrefix}-tab-${state.tab}`}
          className={styles.panel}
        >
          <div
            role="radiogroup"
            aria-label={labels.categories[state.tab]}
            className={styles.cards}
            onKeyDown={onCardKey}
            data-cards={state.tab}
          >
            {ids.map((id, i) => {
              const checked = state.outfit[state.tab] === id;
              const equipped = state.saved[state.tab] === id;
              const isNew = fresh.has(itemKey(state.tab, id));
              return (
                <button
                  key={id}
                  ref={(el) => {
                    cards.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked || (chosen < 0 && i === 0) ? 0 : -1}
                  className={styles.card}
                  data-item={itemKey(state.tab, id)}
                  data-state={equipped ? "equipped" : "owned"}
                  data-new={isNew ? "true" : undefined}
                  onClick={() => dispatch({ type: "choose", slot: state.tab, id })}
                >
                  <span className={styles.cardTop}>
                    <span className={styles.code}>
                      {CODES[state.tab]}-{String(i + 1).padStart(2, "0")}
                    </span>
                    {isNew ? <span className={styles.newTag}>{labels.new}</span> : null}
                  </span>
                  <span className={styles.cardName}>{labels.items[state.tab][id] ?? id}</span>
                  <span className={styles.sub}>{labels.subs[state.tab][id as never] ?? ""}</span>
                  {equipped ? <span className={styles.issued}>{labels.issued}</span> : null}
                </button>
              );
            })}
          </div>
          {state.tab === "hair" || state.tab === "face" ? (
            <div className={styles.colours}>
              <span id={`${idPrefix}-colours`} className={styles.colourLabel}>
                {labels.colourLabel}
              </span>
              <div
                role="radiogroup"
                aria-labelledby={`${idPrefix}-colours`}
                className={styles.swatches}
                onKeyDown={onSwatchKey}
              >
                {OUTFIT_CATALOGUE.hairCol.map((id, i) => {
                  const checked = state.outfit.hairCol === id;
                  return (
                    <button
                      key={id}
                      ref={(el) => {
                        swatches.current[i] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      aria-label={labels.colours[i] ?? id}
                      tabIndex={checked ? 0 : -1}
                      className={styles.swatch}
                      // the catalogue's hair colour ids are the paint the embed uses (bible 10.1)
                      style={{ backgroundColor: id }}
                      data-colour={i}
                      onClick={() => dispatch({ type: "choose", slot: "hairCol", id })}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className={styles.foot}>
            <span className={styles.keys}>{labels.keysHint}</span>
          </div>
        </div>
        {dirty ? (
          <div className={styles.dirtyBar} role="status" data-unsigned>
            <span className={styles.dirtyDot} aria-hidden="true" />
            {labels.dirty}
          </div>
        ) : null}
      </section>
    </div>
  );
}
