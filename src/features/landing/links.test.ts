import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AUTH_LINKS } from "@/features/identity";
import { REPORT_LINKS } from "@/features/results";
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
    for (const ok of [
      "/",
      "/sign-in",
      "/sign-up",
      "/recover",
      "/settings",
      "/privacy",
      "/profile",
      "/welcome",
      "/locker",
      "/lobby/KGB-4821",
    ]) {
      expect(served(ok), ok).toBe(true);
    }
    // four of the seven paths main offered before #875 have no page yet (/privacy shipped with #76,
    // /profile with #932, /locker with #943)
    for (const dead of ["/teachers", "/about", "/terms", "/contact"]) {
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

/** Every non-test source file of a feature. */
function featureSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return featureSources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("Dawn report links (#899)", () => {
  it("C1 the guide href has one definition: the report's tip reads the header's LINKS.guide", () => {
    expect(REPORT_LINKS.guide).toBe(LINKS.guide);
    const tip = readFileSync(path.resolve(__dirname, "../results/view/tip.ts"), "utf8");
    expect(tip).toMatch(/export const GUIDE_HREF = REPORT_LINKS\.guide;/);
  });

  it("C2 every internal href the results feature offers is served by a src/app page", () => {
    const hrefs = {
      home: REPORT_LINKS.home,
      guide: REPORT_LINKS.guide,
      signUp: REPORT_LINKS.signUp,
      lobby: REPORT_LINKS.lobby("KGB-4821"),
    };
    expect(Object.keys(hrefs).sort()).toEqual(Object.keys(REPORT_LINKS).sort());
    for (const [key, href] of Object.entries(hrefs)) {
      expect(served(href), `${key}: ${href}`).toBe(true);
    }
  });

  it("C2 no results source writes an internal href outside REPORT_LINKS", () => {
    const literal = /(?:href\s*[=:]\s*\{?|HREF\s*=\s*)["'`]\//;
    const root = path.resolve(__dirname, "../results");
    for (const file of featureSources(root)) {
      if (file.endsWith(path.join("view", "links.ts"))) continue;
      expect(readFileSync(file, "utf8"), path.relative(root, file)).not.toMatch(literal);
    }
  });
});

describe("Home menu links (#943 C5)", () => {
  it("the landing has one stable URL for a viewer, with its rooms docket and guide section", () => {
    expect(LINKS.landing).toBe("/welcome");
    expect(LINKS.rooms).toBe(`${LINKS.landing}#rooms`);
    expect(LINKS.guide).toBe(`${LINKS.landing}#how`);
    expect(LINKS.how).toBe("#how");
    expect(served(LINKS.landing)).toBe(true);
  });

  it("the open-rooms docket carries the rooms anchor", () => {
    const docket = readFileSync(path.resolve(__dirname, "components/open-rooms.tsx"), "utf8");
    expect(docket).toMatch(/id="rooms"/);
  });
});

describe("the locker link (#943 C23)", () => {
  it("LINKS.locker is /locker, served, so OPEN THE LOCKER → is back", () => {
    expect(LINKS.locker).toBe("/locker");
    expect(served(LINKS.locker!)).toBe(true);
  });
});
