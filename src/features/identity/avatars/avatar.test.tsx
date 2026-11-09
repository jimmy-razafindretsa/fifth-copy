import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Avatar, avatarSrc } from "./avatar";

// #60 C2: a stored, approved picture is the route's image at the matching file size; anyone else gets
// the stamped portrait named by the typist name. Sizes 32, 64, 128.

const stored = {
  id: "u_1",
  name: "comrade_lynx",
  hasAvatar: true,
  avatarVersion: 1_700_000_000_123,
};
const none = { id: "u_2", name: "Lynx-101", hasAvatar: false, avatarVersion: null };

describe("Avatar", () => {
  it.each([
    [32, 64],
    [64, 64],
    [128, 256],
  ] as const)("size %i shows the stored %i px file", (size, file) => {
    const out = renderToStaticMarkup(<Avatar user={stored} size={size} />);
    // React 19 adds a `<link rel="preload" as="image">` hint before the img in static markup.
    expect(out).toMatch(/^(<link rel="preload"[^>]*>)?<img /);
    expect(out).toContain(`src="/api/avatars/u_1?size=${file}&amp;v=1700000000123"`);
    expect(out).toContain('alt="comrade_lynx"');
    expect(out).toContain(`width="${size}" height="${size}"`);
    expect(avatarSrc(stored, size)).toBe(`/api/avatars/u_1?size=${file}&v=1700000000123`);
  });

  it.each([32, 64, 128] as const)(
    "size %i without a picture shows the labelled portrait",
    (size) => {
      const out = renderToStaticMarkup(<Avatar user={none} size={size} />);
      expect(out).toMatch(/^<svg /);
      expect(out).toContain('role="img"');
      expect(out).toContain('aria-label="Lynx-101"');
      expect(out).toContain(`width="${size}"`);
    },
  );

  it("falls back to the portrait when the version is unknown", () => {
    const out = renderToStaticMarkup(
      <Avatar user={{ ...stored, avatarVersion: null }} size={64} />,
    );
    expect(out).toMatch(/^<svg /);
  });

  it("can be decorative beside a visible name", () => {
    expect(renderToStaticMarkup(<Avatar user={stored} size={32} decorative />)).toContain('alt=""');
    expect(renderToStaticMarkup(<Avatar user={none} size={32} decorative />)).toContain(
      'aria-hidden="true"',
    );
  });
});
