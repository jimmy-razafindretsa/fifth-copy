import { keyAttributes, type MachineSkin } from "../../skin";

/**
 * A test-only skin (#558 C4): spans only, no CSS, no space bar. The conformance suite registers it next
 * to the real skins, which proves the seam takes a new look with no change to the frame.
 */
export const plainSkin: MachineSkin<"plain"> = {
  id: "plain",
  Machine: ({ rows, ...state }) => (
    <span>
      {rows.flat().map((key, i) => (
        <span key={i} {...keyAttributes(key, state)}>
          {key}
        </span>
      ))}
    </span>
  ),
};
