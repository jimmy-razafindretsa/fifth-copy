import { renderToReadableStream, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import type { GradeStep } from "./docket-grade";

vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));
vi.mock("../actions/sign-out", () => ({ signOut: async () => {} }));

const { AccountControl } = await import("./account-control");
const { gradeGrace, gradeRead } = await import("./docket-grade");

// #969 C2, C3, C4: the header docket's grade tag, rendered on the server as the header streams it.

const CLASSES = {
  docket: "docket",
  docketName: "name",
  tag: "tag",
  signIn: "signIn",
  grade: "grade",
};
const ACCOUNT = { id: "u1", name: "DOCKET-829", isGuest: false, hasAvatar: false };
const GUEST = { ...ACCOUNT, isGuest: true };

type T = typeof en;
const control = (
  viewer: typeof ACCOUNT | null,
  read: Promise<GradeStep | null> | null,
  t: T = en,
  locale: "en" | "fr" = "en",
) => (
  <AccountControl
    viewer={viewer}
    labels={{ honorific: t.header.honorific, myFile: t.header.myFileName, ...t.auth.account }}
    classes={CLASSES}
    grade={
      read ? { read, ranks: t.landing.clerk.ranks, spoken: t.header.gradeName, locale } : undefined
    }
  />
);
/** The whole stream, shell and streamed segments. */
const streamed = async (node: React.ReactNode) =>
  new Response(await renderToReadableStream(node)).text();
/** The docket link, from its opening tag to its end. */
const link = (html: string) => html.slice(html.indexOf("<a "), html.indexOf("</a>") + 4);
/** What a screen reader names the link: the visible text minus aria-hidden spans (none nest here). */
const spokenName = (html: string) =>
  link(html)
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, "");
/** A read already done, as on a page where it lands within the header's grace time. */
const settled = async (value: GradeStep) => {
  const read = gradeRead(async () => value, ACCOUNT)!;
  await read;
  return { read };
};

describe("header grade tag (#969)", () => {
  it("C2 an account's docket ends with the reference's ink tag inside the /profile link", async () => {
    const { read } = await settled({ rank: "officer" });
    const html = await streamed(control(ACCOUNT, read));
    const a = link(html);
    expect(a).toMatch(/^<a href="\/profile" class="docket"/);
    // the name, then the tag (drawn, aria-hidden), the name hidden from the spoken text
    expect(a).toMatch(
      /<span class="name" aria-hidden="true">Comrade DOCKET-829<\/span>.*<span class="grade" aria-hidden="true" data-docket-grade="officer">OFFICER<\/span>/,
    );
    expect(spokenName(html)).toBe("My file, Comrade DOCKET-829, grade: Officer");
    // one spoken name: no leftover "My file, " prefix beside it
    expect(a.match(/My file, /g)).toHaveLength(1);
  });

  it("C2 in French: OFFICIER, named Mon dossier, <name>, grade : Officier", async () => {
    const { read } = await settled({ rank: "officer" });
    const html = await streamed(control(ACCOUNT, read, fr, "fr"));
    expect(link(html)).toContain('data-docket-grade="officer">OFFICIER</span>');
    expect(spokenName(html)).toBe("Mon dossier, Camarade DOCKET-829, grade : Officier");
  });

  it("C2 the top grade reads the catalogs' longest name, HÉROS DE LA PAPERASSE", async () => {
    const { read } = await settled({ rank: "major" });
    const html = await streamed(control(ACCOUNT, read, fr, "fr"));
    expect(link(html)).toContain(">HÉROS DE LA PAPERASSE</span>");
    expect(spokenName(html)).toBe(
      "Mon dossier, Camarade DOCKET-829, grade : Héros de la paperasse",
    );
  });

  it("C3 a guest keeps the GUEST tag and its name, and nothing is read", async () => {
    const source = vi.fn(async () => ({ rank: "officer" as const }));
    expect(gradeRead(source, GUEST)).toBeNull();
    const html = await streamed(control(GUEST, null));
    expect(link(html)).not.toContain("data-docket-grade");
    expect(link(html).replace(/<[^>]+>/g, "")).toBe("My file, Comrade DOCKET-829GUEST");
    expect(source).not.toHaveBeenCalled();
  });

  it("C3 a visitor with no identity triggers no read and gets SIGN IN", async () => {
    const source = vi.fn(async () => ({ rank: "officer" as const }));
    expect(gradeRead(source, null)).toBeNull();
    expect(gradeRead(undefined, ACCOUNT)).toBeNull();
    const html = await streamed(control(null, null));
    expect(html).not.toContain("/profile");
    expect(html).toContain(">SIGN IN<");
    expect(source).not.toHaveBeenCalled();
  });

  it("C4 while the read is pending: nothing in the tag's place, the link keeps its name", () => {
    const html = renderToString(control(ACCOUNT, new Promise<GradeStep | null>(() => {})));
    expect(html).not.toContain("data-docket-grade");
    // the boundary's fallback: the link's name alone, visually hidden
    expect(link(html)).toContain('<span class="sr-only">My file, Comrade DOCKET-829</span>');
    expect(spokenName(html)).toBe("My file, Comrade DOCKET-829");
  });

  it("C4 a rejected read renders no tag and no error; the link keeps its name", async () => {
    const read = gradeRead(async () => {
      throw new Error("database down");
    }, ACCOUNT)!;
    await expect(read).resolves.toBeNull();
    const html = await streamed(control(ACCOUNT, read));
    expect(html).not.toContain("data-docket-grade");
    expect(spokenName(html)).toBe("My file, Comrade DOCKET-829");
    // a read that throws before its promise exists settles the same way
    const sync = gradeRead(() => {
      throw new Error("no db");
    }, ACCOUNT)!;
    await expect(sync).resolves.toBeNull();
  });

  it("C4 a read done before the docket renders is drawn at once, without a boundary to fill", async () => {
    const { read } = await settled({ rank: "clerk" });
    const html = renderToString(control(ACCOUNT, read));
    expect(html).not.toContain("<!--$?-->");
    expect(html).toContain('data-docket-grade="clerk">CLERK</span>');
  });

  it("C4 a slow read streams in after the shell, into its own boundary", async () => {
    let answer!: (step: GradeStep) => void;
    const read = gradeRead(() => new Promise<GradeStep>((resolve) => (answer = resolve)), ACCOUNT)!;
    const stream = await renderToReadableStream(control(ACCOUNT, read));
    answer({ rank: "commissar" });
    const html = await new Response(stream).text();
    // the shell holds the pending boundary; the tag comes in a later segment
    expect(html.indexOf("<!--$?-->")).toBeGreaterThan(-1);
    expect(html.indexOf('data-docket-grade="commissar"')).toBeGreaterThan(html.indexOf("</a>"));
  });

  it("C4 the header waits for the grade at most the grace time, and never fails on it", async () => {
    vi.useFakeTimers();
    try {
      let settledGrace = false;
      void gradeGrace(new Promise(() => {}), 50).then(() => (settledGrace = true));
      await vi.advanceTimersByTimeAsync(49);
      expect(settledGrace).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settledGrace).toBe(true);
      await expect(gradeGrace(Promise.reject(new Error("x")), 50)).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
