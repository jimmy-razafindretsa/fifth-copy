import type { MachineSkin, MachineSkinId, MachineSkinProps } from "./skin";
import { machineSkins } from "./skins";

export type TypingMachineProps = MachineSkinProps & {
  /** Which machine to draw (a registered skin id); the teleprinter by default. */
  skin?: MachineSkinId;
};

/**
 * The typing machine of the seat view (#558, bible 7.7a): the skin seam. It renders the registered skin
 * named by `skin` inside the frame, so the motion (#224), the jam (#220), the seat layout (#561) and a
 * skin picker (#638) depend on this component and its attributes, never on a skin module. A server
 * component: no state, no effect.
 */
export function TypingMachine({ skin = "teleprinter", ...props }: TypingMachineProps) {
  return <MachineFrame skin={machineSkins[skin]} {...props} />;
}

/**
 * The root every skin shares (internal: not in the feature index). It owns the root contract:
 * `data-machine`, `data-skin`, `data-jammed` (only while jammed) and `aria-hidden` (the whole machine is
 * decoration; the text and its states reach assistive tech through the race HUD).
 */
export function MachineFrame({ skin, ...props }: MachineSkinProps & { skin: MachineSkin<string> }) {
  const { Machine } = skin;
  return (
    <div
      data-machine="true"
      data-skin={skin.id}
      data-jammed={props.jammed ? "true" : undefined}
      aria-hidden="true"
    >
      <Machine {...props} />
    </div>
  );
}
