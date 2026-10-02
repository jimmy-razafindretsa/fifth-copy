import fs from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";
import { parse as parseYaml } from "yaml";

export const ADR_DIR = "docs/adr";
export const INDEX_PATH = path.join(ADR_DIR, "INDEX.json");
export const STATUSES = ["proposed", "accepted", "superseded", "rejected"] as const;
export type AdrStatus = (typeof STATUSES)[number];

export type Adr = {
  id: string;
  title: string;
  status: AdrStatus;
  category: string;
  scope: string[];
  supersedes: string[];
  supersededBy: string[];
  rule: string;
  file: string;
};

const FILE_RE = /^(\d{4})-[a-z0-9-]+\.md$/;

/** Parses one ADR file's frontmatter. Returns errors instead of throwing so the linter can report all. */
export function parseAdr(file: string, text: string): { adr?: Adr; errors: string[] } {
  const errors: string[] = [];
  const base = path.basename(file);
  const m = FILE_RE.exec(base);
  if (!m) return { errors: [`${base}: filename must be NNNN-kebab-slug.md`] };
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fm) return { errors: [`${base}: missing frontmatter`] };
  if (!/^id:\s*["']\d{4}["']/m.test(fm[1]!)) errors.push(`${base}: id must be a quoted string`);
  let data: Record<string, unknown>;
  try {
    data = (parseYaml(fm[1]!) ?? {}) as Record<string, unknown>;
  } catch (e) {
    return { errors: [`${base}: invalid YAML (${(e as Error).message.split("\n")[0]})`] };
  }
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string).trim() : "");
  const list = (k: string) =>
    Array.isArray(data[k]) ? (data[k] as unknown[]).map((v) => String(v)) : null;

  const id = str("id");
  if (id !== m[1]) errors.push(`${base}: id "${id}" must equal filename prefix "${m[1]}"`);
  if (!str("title")) errors.push(`${base}: title required`);
  const status = str("status") as AdrStatus;
  if (!STATUSES.includes(status))
    errors.push(`${base}: status must be one of ${STATUSES.join("|")}`);
  if (!str("category")) errors.push(`${base}: category required`);
  const scope = list("scope");
  if (!scope || scope.length === 0) errors.push(`${base}: scope must be a non-empty list of globs`);
  const supersedes = list("supersedes");
  if (supersedes === null) errors.push(`${base}: supersedes must be a list (may be empty)`);
  const rule = str("rule");
  if (!rule || rule.includes("\n")) errors.push(`${base}: rule must be one line`);

  if (errors.length) return { errors };
  return {
    adr: {
      id,
      title: str("title"),
      status,
      category: str("category"),
      scope: scope!,
      supersedes: supersedes!,
      supersededBy: [],
      rule,
      file: path.posix.join(ADR_DIR, base),
    },
    errors,
  };
}

export function loadAdrs(dir = ADR_DIR): { adrs: Adr[]; errors: string[] } {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "TEMPLATE.md" && f !== "README.md")
    .sort();
  const adrs: Adr[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const r = parseAdr(f, fs.readFileSync(path.join(dir, f), "utf8"));
    errors.push(...r.errors);
    if (r.adr) adrs.push(r.adr);
  }
  return { adrs: linkSupersession(adrs, errors), errors };
}

function linkSupersession(adrs: Adr[], errors: string[]): Adr[] {
  const byId = new Map(adrs.map((a) => [a.id, a]));
  const seen = new Set<string>();
  for (const a of adrs) {
    if (seen.has(a.id)) errors.push(`duplicate ADR id ${a.id}`);
    seen.add(a.id);
    for (const s of a.supersedes) {
      const old = byId.get(s);
      if (!old) errors.push(`${a.id}: supersedes unknown ADR ${s}`);
      else old.supersededBy.push(a.id);
    }
  }
  for (const a of adrs) {
    if (a.status === "superseded" && a.supersededBy.length === 0)
      errors.push(`${a.id}: status superseded but no ADR supersedes it`);
  }
  return adrs;
}

export function renderIndex(adrs: Adr[]): string {
  return (
    JSON.stringify({ generated: "by scripts/adr-index.ts, do not edit", adrs }, null, 2) + "\n"
  );
}

export type Governing = { adr: Adr; warning?: string };

/** ADRs whose scope matches the path. Accepted first, then proposed; superseded/rejected flagged. */
export function governing(adrs: Adr[], target: string): Governing[] {
  const p = target.replace(/^\.\//, "").replace(/\\/g, "/");
  const hits = adrs.filter((a) =>
    a.scope.some(
      (g) =>
        minimatch(p, g, { dot: true }) || minimatch(p, g.replace(/\/\*\*$/, ""), { dot: true }),
    ),
  );
  const order: Record<AdrStatus, number> = { accepted: 0, proposed: 1, superseded: 2, rejected: 3 };
  return hits
    .sort((a, b) => order[a.status] - order[b.status] || a.id.localeCompare(b.id))
    .map((adr) => ({
      adr,
      warning:
        adr.status === "superseded"
          ? `SUPERSEDED by ${adr.supersededBy.join(", ")}: follow the newer ADR`
          : adr.status === "proposed"
            ? "PROPOSED (not yet accepted by a human): treat as intended direction, not law"
            : adr.status === "rejected"
              ? "REJECTED: do not follow"
              : undefined,
    }));
}
