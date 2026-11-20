import { fill } from "@/i18n/format";

/**
 * The intercepted-cable header (#999 C40, R26; bible 4 "Special Elite for intercepted-cable headers,
 * never text to type", 7.7): one in-world line framing the race text above the telex tape. It is
 * chosen from the catalog's `race.telex.cables` templates by the race id, so every desk of a race and
 * every reload reads the same header, and the cable number `{n}` (1000 to 9999) comes from the same
 * id. Pure; it is never part of the text to type (the strip's chars and the race text never see it).
 */
export function cableHeader(raceId: string, templates: readonly string[]): string | null {
  if (templates.length === 0) return null;
  // FNV-1a over the id's UTF-16 units: stable across runtimes, no crypto needed (not a secret)
  let hash = 0x811c9dc5;
  for (let i = 0; i < raceId.length; i++) {
    hash ^= raceId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const template = templates[hash % templates.length]!;
  return fill(template, { n: 1000 + (Math.floor(hash / templates.length) % 9000) });
}
