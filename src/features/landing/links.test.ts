import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AUTH_LINKS } from "@/features/identity";
import { LINKS, SOCIAL_LINKS } from "./links";

// The identity index reaches src/env.ts through its server modules; the route table needs no secrets.
vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

// #875 C1: a link appears only when its route ships (bible 14.1, 14.3). Every internal path the public
// screens offer must be served by a src/app page; a social entry must name a profile, not a site's home.

const APP = path.resolve(__dirname, "../../app");

/** The URL patterns of every `page.tsx` under src/app: route groups dropped, dynamic segments wild. */
function pageRoutes(dir = APP, segments: string[] = []): RegExp[] {
  const routes: RegExp[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "page.tsx") {
      const parts = segments.map((s) => (/^\[.+\]$/.test(s) ? "[^/]+" : s.replace(/[.]/g, "\\.")));
      routes.push(new RegExp(`^/${parts.join("/")}$`));
    } else if (entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("@")) {
      const group = /^\(.+\)$/.test(entry.name);
      routes.push(
        ...pageRoutes(path.join(dir, entry.name), group ? segments : [...segments, entry.name]),
      );
    }
  }
  return routes;
}

const ROUTES = pageRoutes();

/** Whether a src/app page serves this internal href (query and anchor aside). */
function served(href: string): boolean {
  const pathname = href.split(/[?#]/)[0] || "/";
  return ROUTES.some((route) => route.test(pathname));
}

/** A URL with no path: the home page of a whole site, not a profile on it. */
function bareHome(href: string): boolean {
  return new URL(href).pathname.replace(/\/+$/, "") === "";
}

const internal = (links: Record<string, string | undefined>) =>
  Object.entries(links).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && entry[1].startsWith("/"),
  );

describe("public links (#875 C1)", () => {
  it("the route walk finds the shipped pages and refuses the ones that do not exist", () => {
    for (const ok of ["/", "/sign-in", "/sign-up", "/recover", "/settings", "/lobby/KGB-4821"]) {
      expect(served(ok), ok).toBe(true);
    }
    // the seven paths main offered before #875: none has a page
    for (const dead of [
      "/locker",
      "/teachers",
      "/profile",
      "/about",
      "/privacy",
      "/terms",
      "/contact",
    ]) {
      expect(served(dead), dead).toBe(false);
    }
  });

  it("every internal path in LINKS and AUTH_LINKS is served by a src/app page", () => {
    const paths = [...internal(LINKS), ...internal(AUTH_LINKS)];
    expect(paths.length).toBeGreaterThan(0);
    for (const [key, href] of paths) {
      expect(served(href), `${key}: ${href}`).toBe(true);
    }
  });

  it("no SOCIAL_LINKS entry is a bare site home page", () => {
    // the four placeholders main shipped would fail
    for (const home of ["https://github.com", "https://linkedin.com", "https://discord.com/"]) {
      expect(bareHome(home), home).toBe(true);
    }
    expect(bareHome("https://github.com/aegis-corp")).toBe(false);
    for (const social of SOCIAL_LINKS) {
      expect(bareHome(social.href), social.href).toBe(false);
    }
  });
});
