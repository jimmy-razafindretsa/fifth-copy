/**
 * One-shot vendoring of the web app's six brand fonts (#574, components.md "Fonts"): fetches the exact
 * woff2 subsets next/font/google used to download at build time, plus each family's licence, and writes
 * them under public/fonts/, where src/app/fonts.ts loads them through next/font/local. The build itself
 * never touches the network for fonts (scripts/offline-build.sh checks it).
 *
 *   npx tsx scripts/fonts-vendor.ts    (needs network; run by hand only to re-vendor, then commit the output)
 *
 * Hosts: fonts.googleapis.com (css2, same URL and User-Agent as next/font/google), fonts.gstatic.com
 * (woff2) and github.com/google/fonts (licence texts; GitHub redirects raw files to its content host).
 * Nothing fetched is executed. It prints each face's weight and unicode-range to keep fonts.ts in sync.
 * Licences: SIL OFL 1.1 for five families, Apache 2.0 for Special Elite (google/fonts `apache/`).
 * When Google serves one (variable) file for several weights of a subset, as for Oswald, the file is
 * written once as <family>-<w1>-<w2>-<subset>.woff2 and fonts.ts declares each weight on it, as Google's CSS does.
 */
import fs from "node:fs";
import path from "node:path";

/** Families, weights and subsets exactly as layout.tsx asked next/font/google for them before #574. */
const FAMILIES = [
  {
    family: "Stardos Stencil",
    weights: ["700"],
    subsets: ["latin"],
    licence: "ofl/stardosstencil/OFL.txt",
  },
  {
    family: "Oswald",
    weights: ["600", "700"],
    subsets: ["latin", "latin-ext", "cyrillic"],
    licence: "ofl/oswald/OFL.txt",
  },
  {
    family: "IBM Plex Mono",
    weights: ["400", "700"],
    subsets: ["latin", "latin-ext", "cyrillic"],
    licence: "ofl/ibmplexmono/OFL.txt",
  },
  {
    family: "Special Elite",
    weights: ["400"],
    subsets: ["latin", "latin-ext"],
    licence: "apache/specialelite/LICENSE.txt",
  },
  {
    family: "Courier Prime",
    weights: ["400", "700"],
    subsets: ["latin", "latin-ext"],
    licence: "ofl/courierprime/OFL.txt",
  },
  {
    family: "VT323",
    weights: ["400"],
    subsets: ["latin", "latin-ext"],
    licence: "ofl/vt323/OFL.txt",
  },
] as const;

// The User-Agent next/font/google sends (node_modules/next/dist/compiled/@next/font/dist/google/fetch-resource.js):
// it decides that Google serves woff2.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36";
const ALLOWED_HOSTS = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "github.com",
  "raw.githubusercontent.com",
]);
const OUT = path.join(process.cwd(), "public/fonts");

async function get(url: string): Promise<Buffer> {
  if (!ALLOWED_HOSTS.has(new URL(url).hostname)) throw new Error(`host not allowed: ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
  if (!ALLOWED_HOSTS.has(new URL(res.url).hostname))
    throw new Error(`redirected off the allowed hosts: ${res.url}`);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The css2 URL next/font/google builds for a non-italic family (get-google-fonts-url.js). */
const cssUrl = (family: string, weights: readonly string[]) =>
  `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${[...weights].sort().join(";")}&display=swap`;

type Face = { subset: string; weight: string; url: string; unicodeRange: string };

function parseFaces(css: string): Face[] {
  return [...css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)].map(
    ([, subset = "", body = ""]) => ({
      subset,
      weight: /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? "",
      url: /src:\s*url\(([^)]+)\)/.exec(body)?.[1]?.trim() ?? "",
      unicodeRange: /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? "",
    }),
  );
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let files = 0;
  let bytes = 0;
  for (const { family, weights, subsets, licence } of FAMILIES) {
    const slug = family.toLowerCase().replace(/ /g, "-");
    const faces = parseFaces((await get(cssUrl(family, weights))).toString("utf8"));
    for (const subset of subsets) {
      const picked = weights.map((weight) => {
        const face = faces.find((f) => f.subset === subset && f.weight === weight);
        if (!face) throw new Error(`${family} ${weight} ${subset}: not served by Google Fonts`);
        return face;
      });
      for (const url of new Set(picked.map((f) => f.url))) {
        const same = picked.filter((f) => f.url === url);
        const data = await get(url);
        const name = `${slug}-${same.map((f) => f.weight).join("-")}-${subset}.woff2`;
        fs.writeFileSync(path.join(OUT, name), data);
        files++;
        bytes += data.length;
        console.log(
          `${name}\t${data.length}\tweights ${same.map((f) => f.weight).join(",")}\t${same[0]?.unicodeRange}`,
        );
      }
    }
    const text = await get(`https://github.com/google/fonts/raw/main/${licence}`);
    const kind = licence.startsWith("apache/") ? "Apache-2.0" : "OFL";
    fs.writeFileSync(path.join(OUT, `${slug}-LICENSE-${kind}.txt`), text);
    files++;
    bytes += text.length;
  }
  console.log(`fonts-vendor: ${files} files, ${bytes} bytes in public/fonts`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
