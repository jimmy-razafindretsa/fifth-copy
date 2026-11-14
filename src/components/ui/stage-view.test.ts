import { describe, expect, it } from "vitest";
import { stageView as fromIndex } from "@/components/ui";
import { stageView } from "./stage-view";

// #946 C6: one 3D-or-picture rule for the Personnel file and the Home menu stage.
describe("stageView", () => {
  it.each([
    [{ clerkSrc: "/3d/clerk.html", still: false, webgl: true }, "clerk"],
    [{ clerkSrc: null, still: false, webgl: true }, "picture"],
    [{ clerkSrc: "/3d/clerk.html", still: true, webgl: true }, "picture"],
    [{ clerkSrc: "/3d/clerk.html", still: false, webgl: false }, "picture"],
    [{ clerkSrc: "/3d/clerk.html", still: false, webgl: null }, "picture"],
    [{ clerkSrc: "/3d/clerk.html", still: false, webgl: true, reducedMotion: true }, "picture"],
    [{ clerkSrc: "/3d/clerk.html", still: false, webgl: true, reducedMotion: false }, "clerk"],
  ] as const)("%j -> %s", (input, view) => {
    expect(stageView(input)).toBe(view);
  });

  it("is exported by the ui index", () => {
    expect(fromIndex).toBe(stageView);
  });
});
