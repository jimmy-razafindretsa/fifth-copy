/**
 * UI eyes (agents/roles/ui.md). With the dev server running:
 *   npx tsx scripts/see.ts <ISSUE> <route> [--base http://localhost:3000] [--viewports mobile,tablet,desktop] [--theme light|dark]
 *
 * Writes to .eyes/<ISSUE>/ (gitignored): <slug>-<viewport>.png and <slug>-<viewport>.aria.yml
 * Prints one line per viewport: console errors, failed requests, axe serious/critical violations.
 * Exit 1 if any viewport has errors, failed requests or serious/critical violations.
 * Only localhost / preview URLs: anything else is refused.
 */
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import { VIEWPORTS } from "../playwright.config";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const [issue, route] = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
if (!issue || !route) {
  console.error(
    "usage: see.ts <ISSUE> <route> [--base URL] [--viewports a,b] [--theme light|dark]",
  );
  process.exit(2);
}
if (!/^[A-Za-z0-9_-]+$/.test(issue)) {
  console.error("see: ISSUE must be an identifier like ENG-12");
  process.exit(2);
}

const base = (flag("base") ?? process.env.SEE_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const allowedHosts = [
  "localhost",
  "127.0.0.1",
  "[::1]",
  ...(process.env.SEE_ALLOWED_HOSTS ?? "").split(","),
];
const host = new URL(base).hostname;
if (!allowedHosts.filter(Boolean).includes(host) && !host.endsWith(".localhost")) {
  console.error(
    `see: refusing ${host}. Only localhost/preview hosts (SEE_ALLOWED_HOSTS) are allowed.`,
  );
  process.exit(2);
}
const names = (flag("viewports") ?? Object.keys(VIEWPORTS).join(",")).split(
  ",",
) as (keyof typeof VIEWPORTS)[];
const theme = (flag("theme") ?? "light") as "light" | "dark";
const outDir = path.join(".eyes", issue);
const slug = route.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "_") || "root";
fs.mkdirSync(outDir, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  let bad = 0;
  try {
    for (const name of names) {
      const viewport = VIEWPORTS[name];
      if (!viewport) throw new Error(`unknown viewport ${name}`);
      const context = await browser.newContext({
        viewport,
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const failed: string[] = [];
      page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
      page.on("pageerror", (e) => consoleErrors.push(e.message));
      page.on("requestfailed", (r) => failed.push(`${r.method()} ${r.url()}`));
      page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));

      const res = await page.goto(base + route, { waitUntil: "networkidle" });
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const serious = axe.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );

      const file = path.join(outDir, `${slug}-${name}${theme === "light" ? "" : `-${theme}`}`);
      await page.screenshot({ path: `${file}.png`, fullPage: true });
      fs.writeFileSync(`${file}.aria.yml`, await page.locator("body").ariaSnapshot());
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

      const problems = consoleErrors.length + failed.length + serious.length;
      if (problems) bad++;
      console.log(
        [
          `${problems ? "FAIL" : "ok  "} ${name} ${viewport.width}x${viewport.height}`,
          `status=${res?.status() ?? "?"}`,
          `console_errors=${consoleErrors.length}`,
          `failed_requests=${failed.length}`,
          `axe_serious=${serious.length}`,
          `axe_other=${axe.violations.length - serious.length}`,
          overflow ? "h-overflow=YES" : "h-overflow=no",
          `-> ${file}.{png,aria.yml}`,
        ].join(" | "),
      );
      for (const m of [...consoleErrors, ...failed].slice(0, 3))
        console.log(`     ${m.slice(0, 160)}`);
      for (const v of serious.slice(0, 3)) console.log(`     axe ${v.id} (${v.impact}): ${v.help}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(`see: ${(e as Error).message.split("\n")[0]}`);
  process.exit(1);
});
