import type { MachineSkin, MachineSkinId } from "../skin";
import { teleprinter } from "./teleprinter";

export { machineSkinIds } from "../skin";
export type { MachineSkin, MachineSkinId, MachineSkinProps } from "../skin";

/**
 * The machine skin registry (#558, bible 7.7a): the only production importer of a skin module. A new skin
 * is `skins/<id>.tsx` + `skins/<id>.module.css` (+ a `machine-*` role when it needs a colour), its id in
 * `machineSkinIds`, one line here and a 7.7a entry; `skins/conformance.test.tsx` checks it unchanged.
 */
export const machineSkins: Record<MachineSkinId, MachineSkin> = { teleprinter };
