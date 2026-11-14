/**
 * The locker form's state (#943 C25, bible 14.2): the outfit on the clerk, the outfit on file and the
 * filing status. Pure (a reducer), so the client leaf stays thin and the rules are unit-tested. v1 has
 * no locked items: every catalogue id is owned and wearable (locks need #333).
 */
import { OUTFIT_CATALOGUE, OUTFIT_CATEGORIES, type Outfit, type OutfitCategory } from "./outfit";

/** The locker reference's default issue (`DEF`): what `/3d/clerk.html?locker=1` starts in. */
export const DEFAULT_OUTFIT: Outfit = {
  hair: "side",
  glasses: "round",
  hat: "none",
  clothes: "vest",
  face: "stache",
  hairCol: OUTFIT_CATALOGUE.hairCol[0],
};

export type LockerStatus = "idle" | "filing" | "filed" | "refused";

export type LockerState = {
  tab: OutfitCategory;
  /** On the clerk now. */
  outfit: Outfit;
  /** On file (saved). */
  saved: Outfit;
  status: LockerStatus;
};

export type LockerAction =
  | { type: "tab"; tab: OutfitCategory }
  | { type: "choose"; slot: OutfitCategory | "hairCol"; id: string }
  | { type: "undo" }
  | { type: "random"; random: () => number }
  | { type: "filing" }
  | { type: "filed" }
  | { type: "settle" }
  | { type: "refused" };

const SLOTS = [...OUTFIT_CATEGORIES, "hairCol"] as const;

export const sameOutfit = (a: Outfit, b: Outfit) => SLOTS.every((k) => a[k] === b[k]);

export const isDirty = (state: LockerState) => !sameOutfit(state.outfit, state.saved);

export function initialLockerState(saved: Outfit | null): LockerState {
  const onFile = saved ?? DEFAULT_OUTFIT;
  return { tab: "hair", outfit: { ...onFile }, saved: { ...onFile }, status: "idle" };
}

/** A random valid outfit (owned items only: all of them in v1), `random` in [0, 1). */
export function randomOutfit(random: () => number): Outfit {
  const pick = (ids: readonly string[]) => ids[Math.floor(random() * ids.length)] ?? ids[0]!;
  const outfit = {} as Outfit;
  for (const slot of SLOTS) outfit[slot] = pick(OUTFIT_CATALOGUE[slot]);
  return outfit;
}

export function lockerReducer(state: LockerState, action: LockerAction): LockerState {
  switch (action.type) {
    case "tab":
      return { ...state, tab: action.tab };
    case "choose": {
      if (!(OUTFIT_CATALOGUE[action.slot] as readonly string[]).includes(action.id)) return state;
      return { ...state, outfit: { ...state.outfit, [action.slot]: action.id }, status: "idle" };
    }
    case "undo":
      return { ...state, outfit: { ...state.saved }, status: "idle" };
    case "random":
      return { ...state, outfit: randomOutfit(action.random), status: "idle" };
    case "filing":
      return { ...state, status: "filing" };
    case "filed":
      return { ...state, saved: { ...state.outfit }, status: "filed" };
    case "settle":
      return state.status === "filed" ? { ...state, status: "idle" } : state;
    case "refused":
      return { ...state, status: "refused" };
  }
}

/** page -> clerk (bible 15, `?locker=1`): wear this outfit, with the try-on bounce. */
export const setCfgMessage = (cfg: Outfit) => ({ type: "fc-setcfg", cfg: { ...cfg } }) as const;
