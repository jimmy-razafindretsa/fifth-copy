import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MotionSafe as MotionSafeFromIndex,
  useReducedMotion as hookFromIndex,
} from "@/components/ui";
import {
  MotionSafe,
  MotionSafeView,
  REDUCED_MOTION_QUERY,
  readReducedMotion,
  useReducedMotion,
} from "./motion";

// #28 C3 C4: the reader, the wrapper and their server render. Live changes run in e2e/motion.spec.ts.
describe("readReducedMotion (C3)", () => {
  it.each([
    [false, null, false],
    [false, "", false],
    [false, "full", false],
    [true, null, true],
    [true, "full", true],
    [false, "reduce", true],
    [true, "reduce", true],
  ] as const)("media %s, data-motion %s -> %s", (media, attr, expected) => {
    expect(readReducedMotion(media, attr)).toBe(expected);
  });

  it("reads the standard media query", () => {
    expect(REDUCED_MOTION_QUERY).toBe("(prefers-reduced-motion: reduce)");
  });
});

describe("MotionSafeView (C4)", () => {
  it("renders children when motion is allowed", () => {
    const html = renderToStaticMarkup(
      <MotionSafeView reduced={false} fallback={<i>still</i>}>
        <b>moving</b>
      </MotionSafeView>,
    );
    expect(html).toBe("<b>moving</b>");
  });

  it("renders the fallback under reduce", () => {
    const html = renderToStaticMarkup(
      <MotionSafeView reduced fallback={<i>still</i>}>
        <b>moving</b>
      </MotionSafeView>,
    );
    expect(html).toBe("<i>still</i>");
  });

  it("renders nothing under reduce without a fallback", () => {
    expect(renderToStaticMarkup(<MotionSafeView reduced>moving</MotionSafeView>)).toBe("");
  });
});

describe("SSR (C3 C4)", () => {
  it("the hook reads false on the server, so MotionSafe renders its children", () => {
    function Probe() {
      return <span>{String(useReducedMotion())}</span>;
    }
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>false</span>");
    expect(
      renderToStaticMarkup(
        <MotionSafe fallback={<i>still</i>}>
          <b>moving</b>
        </MotionSafe>,
      ),
    ).toBe("<b>moving</b>");
  });

  it("is exported from the primitives index", () => {
    expect(MotionSafeFromIndex).toBe(MotionSafe);
    expect(hookFromIndex).toBe(useReducedMotion);
  });
});
