import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";

vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));
vi.mock("../actions/sign-out", () => ({ signOut: async () => {} }));

const { AccountControl, PROFILE_HREF } = await import("./account-control");

const CLASSES = { docket: "docket", docketName: "name", tag: "tag", signIn: "signIn" };
const labels = (t: typeof en, myFile = true) => ({
  honorific: t.header.honorific,
  ...(myFile ? { myFile: t.header.myFileName } : {}),
  ...t.auth.account,
});
const render = (viewer: { isGuest: boolean } | null, t = en, myFile = true) =>
  renderToStaticMarkup(
    <AccountControl
      viewer={viewer && { id: "u1", name: "DOCKET-829", hasAvatar: false, ...viewer }}
      labels={labels(t, myFile)}
      classes={CLASSES}
    />,
  );
const text = (html: string) => html.replace(/<[^>]+>/g, "");

// #932 C9: the header docket is a link to the viewer's Personnel file, named "My file" and the name.
describe("AccountControl docket link", () => {
  it("a guest's docket links to /profile, its name starting with My file", () => {
    const html = render({ isGuest: true });
    expect(PROFILE_HREF).toBe("/profile");
    expect(html).toMatch(/^<a href="\/profile" class="docket"/);
    expect(text(html.slice(0, html.indexOf("</a>")))).toBe("My file, Comrade DOCKET-829GUEST");
  });

  it("an account's docket too, in French", () => {
    const html = render({ isGuest: false }, fr);
    expect(html).toMatch(/^<a href="\/profile" class="docket"/);
    expect(text(html.slice(0, html.indexOf("</a>")))).toBe("Mon dossier, Camarade DOCKET-829");
  });

  it("without the myFile label the docket stays a plain block; no viewer, no docket", () => {
    expect(render({ isGuest: true }, en, false)).toMatch(/^<div class="docket"/);
    expect(render(null)).not.toContain("/profile");
  });
});
