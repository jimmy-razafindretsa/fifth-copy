import type { SaveClerkOutfit } from "@/features/identity";
import { sameOutfit, type Outfit } from "./embed-messages";

/**
 * Decides which `fc-clerk` outfits are saved (#687): every one that differs from the last saved, so the
 * first random issue of a viewer with nothing saved and every REISSUE UNIFORM hop are saved, and the echo
 * of the saved outfit (`?cfg=`) is not sent again. No `save` (a visitor without identity): never calls out.
 * Cosmetic: a failed or refused save rolls the memory back so the next report retries.
 */
export function outfitSaver(save: SaveClerkOutfit | null, saved: Outfit | null) {
  let last = saved;
  return (cfg: Outfit): void => {
    if (!save || sameOutfit(cfg, last)) return;
    const previous = last;
    last = cfg;
    const rollBack = () => {
      if (last === cfg) last = previous;
    };
    save(cfg).then((result) => {
      if (!result.saved) rollBack();
    }, rollBack);
  };
}
