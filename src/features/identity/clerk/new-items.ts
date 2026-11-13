/**
 * The catalogue's `NEW` items (bible 10.1: glasses `square`, hat `kepka`; #943 part E), one data list,
 * and the "seen in the locker" cookie that clears the menu's `<n> NEW` tag. Pure (no zod: the locker
 * form is a client leaf, #626); the cookie holds item ids only, validated against this list.
 */
import type { OutfitCategory } from "./outfit";

export const NEW_ITEMS = ["glasses:square", "hat:kepka"] as const;
export type NewItemId = (typeof NEW_ITEMS)[number];

/** The cookie that remembers the `NEW` items this browser saw in the locker (one year). */
export const LOCKER_SEEN_COOKIE = "fc_locker_seen";
export const LOCKER_SEEN_MAX_AGE_S = 365 * 24 * 3600;

/** `category:id` of one catalogue item. */
export const itemKey = (category: OutfitCategory, id: string) => `${category}:${id}`;

const isNewItem = (value: string): value is NewItemId =>
  (NEW_ITEMS as readonly string[]).includes(value);

/**
 * The seen ids in a cookie value: comma-separated ids of the list. A value with anything else in it is
 * tampered and ignored whole (the tag reads as if nothing was seen).
 */
export function parseSeen(value: string | undefined | null): NewItemId[] {
  if (!value) return [];
  const parts = value.split(",");
  if (parts.length > NEW_ITEMS.length || !parts.every(isNewItem)) return [];
  return NEW_ITEMS.filter((id) => parts.includes(id));
}

/** The cookie value for `ids` (list order, no duplicates). */
export const serializeSeen = (ids: readonly NewItemId[]) =>
  NEW_ITEMS.filter((id) => ids.includes(id)).join(",");

/** The `NEW` items not yet seen. */
export const unseenNewItems = (seen: readonly NewItemId[]): NewItemId[] =>
  NEW_ITEMS.filter((id) => !seen.includes(id));
