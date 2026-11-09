import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures";
import { HYDRATION_WAIT } from "../timeouts";

// Shared steps of the #66 settings specs.

export const settingsDocket = (page: Page) => page.locator("main [data-settings]").first();

/** A section's radio group by its accessible name (the section title). */
export const group = (scope: Page | Locator, name: string | RegExp) =>
  scope.getByRole("radiogroup", { name });

/** Opens `/settings` and waits until every control has hydrated (a click before then would not save). */
export async function openSettings(page: Page) {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    settingsDocket(page).locator('[role="radiogroup"]:not([data-hydrated])'),
  ).toHaveCount(0, { timeout: HYDRATION_WAIT });
}

/** The typist name the header's account docket shows (`Comrade X` / `Camarade X`). */
export async function headerTypist(page: Page): Promise<string> {
  const text = (await page.getByRole("banner").textContent()) ?? "";
  const match = /(?:Comrade|Camarade) (\S+?-\d{3,4})/.exec(text);
  if (!match) throw new Error(`no typist name in the header: ${text}`);
  return match[1]!;
}

/** Chooses a radio in a section and waits for its save state to read FILED (or CLASSÉ). */
export async function choose(page: Page, section: string | RegExp, option: string) {
  const radios = group(settingsDocket(page), section);
  const radio = radios.getByRole("radio", { name: option, exact: true });
  // the radio is visually hidden inside its label: a person clicks the label (segment or card)
  await radios
    .locator("label")
    .filter({ has: page.getByRole("radio", { name: option, exact: true }) })
    .click();
  await expect(radio).toBeChecked();
  // found by its chosen radio: a language change renames the section itself
  const region = settingsDocket(page)
    .locator("section")
    .filter({ has: page.getByRole("radio", { name: option, exact: true }) });
  await expect(region.getByRole("status")).toHaveText(/^(FILED|CLASSÉ)$/);
}
