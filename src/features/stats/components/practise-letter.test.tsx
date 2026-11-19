import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { keyFileFixtures } from "../view/key-file-fixtures";
import { practiceRequest } from "../view/key-sheet";
import { KeySheetSection } from "./key-sheet-section";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

// #999 C47: "Practise this letter" sits in the key's detail, under the chips, for the selected key,
// and asks the practice lobby for that key as the only practice letter.

const action = async () => ({ ok: true as const, code: "KGB-0001" });

const render = (lang: "fr" | "en", practise?: typeof action) =>
  renderToStaticMarkup(
    <KeySheetSection
      keyFile={keyFileFixtures.twoWeeks}
      labels={(lang === "fr" ? fr : en).profile.keySheet}
      locale={lang}
      id="t-key-sheet"
      heading="h2"
      practise={practise}
    />,
  );

describe("Practise this letter (#999 C47)", () => {
  it("the button follows the chips and names the selected key, in both languages", () => {
    const html = render("en", action);
    const selected = /data-key-selected="([^"]+)"/.exec(html)![1]!;
    const cap = selected.toLocaleUpperCase("en");
    expect(html).toContain(`data-key-practise="${selected}"`);
    expect(html).toContain(`>PRACTISE THIS LETTER · ${cap}</button>`);
    expect(html.indexOf("data-key-chips")).toBeLessThan(html.indexOf("data-key-practise"));
    expect(html.indexOf("data-key-practise")).toBeLessThan(html.indexOf('data-key-stat="latest"'));
    expect(render("fr", action)).toContain(`>ENTRAÎNER CETTE LETTRE · ${cap}</button>`);
  });

  it("without the action (a /design specimen) there is no button", () => {
    expect(render("en")).not.toContain("data-key-practise");
  });

  it("asks for that key only, in random words; an accented key in French", () => {
    expect(practiceRequest("e", "en")).toEqual({
      practiceLetters: ["e"],
      language: "en",
      textType: "words",
    });
    expect(practiceRequest("e", "fr").language).toBe("fr");
    expect(practiceRequest("ç", "en")).toEqual({
      practiceLetters: ["ç"],
      language: "fr",
      textType: "words",
    });
  });
});
