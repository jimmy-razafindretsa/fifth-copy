import { z } from "zod";

/**
 * The embedding protocol (bible 15) as parsed at the edge. The clerk and lobby pages post with `'*'`;
 * the page only listens to its own origin and its own iframes (use-embed-bridge.ts).
 */
export const OUTFIT_CATEGORIES = ["hair", "glasses", "hat", "clothes", "face"] as const;
export type OutfitCategory = (typeof OUTFIT_CATEGORIES)[number];

export const outfitSchema = z.object({
  hair: z.string(),
  glasses: z.string(),
  hat: z.string(),
  clothes: z.string(),
  face: z.string(),
  hairCol: z.string().optional(),
});
export type Outfit = z.infer<typeof outfitSchema>;

/** clerk -> page: the outfit the clerk is wearing now. */
export const clerkMessageSchema = z.object({ type: z.literal("fc-clerk"), cfg: outfitSchema });

/** lobby -> page: the camera the lobby is showing. */
export const viewMessageSchema = z.object({
  type: z.literal("fc-view"),
  view: z.enum(["over", "pov"]),
});

export const FEED_VIEWS = ["over", "pov", "auto"] as const;
export type FeedView = (typeof FEED_VIEWS)[number];

/** page -> embeds */
export const lookMessage = (x: number, y: number) => ({ type: "fc-look", x, y }) as const;
export const reissueMessage = () => ({ type: "fc-reissue" }) as const;
export const setViewMessage = (view: FeedView) => ({ type: "fc-setview", view }) as const;
