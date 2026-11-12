/**
 * Stale-deploy detector (#718, ADR 0019). Reads the public web `/api/health` and race-server `/health`,
 * and decides whether each Railway service runs the commit main expects for it and the protocol of main.
 *
 * The one rule: Railway skips a service whose watch paths did not change, so its deployed commit may lag
 * main. A service is current when its deployed commit is an ancestor of (or equal to) HEAD and the newest
 * main commit touching its watch paths is an ancestor of (or equal to) the deployed commit. A deployed
 * commit newer than HEAD counts too when it is on main (#914): production already runs a later merge, so
 * this run's commit is superseded, not stale. Every service's `protocol` must equal PROTOCOL_VERSION at
 * HEAD, or at the deployed commit when that one is newer. Anything else, `commit: null` included, fails.
 *
 * Usage: npx tsx scripts/deploy-check.ts --web <url> --race <url>   (prints OK, or one line per failing
 * service; exit 1 on a failure). Run by `.github/workflows/deploy-check.yml`; redeploy steps:
 * docs/ops/runbook.md "Stale deploy". It never calls Railway and holds no token.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** One service to compare. A new service (e.g. the worker, ADR 0011) is one more record. */
export type ServiceRecord = {
  service: string;
  /** Commit the service reports in its health body, null when absent or unreachable. */
  deployed: string | null;
  /** Newest main commit touching the service's watch paths. */
  expected: string;
  head: string;
  /** Tip of main as fetched (origin/main); HEAD when unknown. A deployed commit past HEAD must be on it. */
  main?: string;
  /** PROTOCOL_VERSION the service reports, null when absent or unreachable. */
  protocol: number | null;
};

export type Git = {
  isAncestor(ancestor: string, descendant: string): boolean;
  protocolAt(commit: string): number;
};

export type Verdict = { ok: boolean; lines: string[] };

const COMMIT = /^[0-9a-f]{7,40}$/i;
/** Health bodies come from the network: only a commit-shaped value is ever printed or passed to git. */
const shown = (sha: string | null) => (sha === null ? "null" : COMMIT.test(sha) ? sha : "invalid");

/** Pure: the verdict over every record. One line per failing service (STALE wins over PROTOCOL). */
export function verdict(records: ServiceRecord[], git: Git): Verdict {
  const lines: string[] = [];
  const mainProtocol = new Map<string, number>();
  for (const r of records) {
    const deployed = r.deployed !== null && COMMIT.test(r.deployed) ? r.deployed : null;
    const behind = deployed !== null && git.isAncestor(deployed, r.head);
    // #914: a later main commit already deployed supersedes this run's HEAD.
    const ahead =
      deployed !== null &&
      !behind &&
      git.isAncestor(r.head, deployed) &&
      git.isAncestor(deployed, r.main ?? r.head);
    const current = (behind || ahead) && git.isAncestor(r.expected, deployed!);
    if (!current) {
      lines.push(`STALE ${r.service} deployed=${shown(r.deployed)} expected=${r.expected}`);
      continue;
    }
    const at = ahead ? deployed! : r.head;
    if (!mainProtocol.has(at)) mainProtocol.set(at, git.protocolAt(at));
    const main = mainProtocol.get(at)!;
    if (r.protocol !== main) {
      lines.push(`PROTOCOL ${r.service} deployed=${r.protocol ?? "null"} main=${main}`);
    }
  }
  if (lines.length > 0) return { ok: false, lines };
  const summary = records.map((r) => `${r.service}=${r.deployed!.slice(0, 7)}`).join(" ");
  return { ok: true, lines: [`OK ${summary}`.trim()] };
}

/**
 * Railway watch paths per service (ADR 0019), as git pathspecs. web: everything except the race server,
 * docs, card logs, agents and e2e; race-server: its workspace, the shared packages and the lockfile.
 */
export const WATCH_PATHS = {
  web: [
    ".",
    ":(exclude)services/race-server",
    ":(exclude)docs",
    ":(exclude)work",
    ":(exclude)agents",
    ":(exclude)e2e",
  ],
  "race-server": ["services/race-server", "packages", "package-lock.json"],
} as const;
export type Service = keyof typeof WATCH_PATHS;

function git(cwd: string, args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

/** Newest commit on main's first-parent line (a merge lands as one commit, as Railway sees it) touching the service. */
export function expectedCommit(service: Service, cwd = process.cwd()): string {
  const out = git(cwd, [
    "log",
    "-1",
    "--first-parent",
    "--format=%H",
    "HEAD",
    "--",
    ...WATCH_PATHS[service],
  ]);
  const sha = out.stdout.trim();
  if (out.status !== 0 || !COMMIT.test(sha))
    throw new Error(`deploy-check: no commit touches ${service}`);
  return sha;
}

export function createGit(cwd = process.cwd()): Git {
  return {
    isAncestor(ancestor, descendant) {
      if (!COMMIT.test(ancestor) || !COMMIT.test(descendant)) return false;
      // Exit 0 = ancestor, 1 = not, anything else (unknown commit) counts as not.
      return git(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
    },
    protocolAt(commit) {
      const out = git(cwd, ["show", `${commit}:packages/protocol/src/version.ts`]);
      const match = /PROTOCOL_VERSION\s*=\s*(\d+)/.exec(out.stdout);
      if (out.status !== 0 || !match)
        throw new Error("deploy-check: PROTOCOL_VERSION not found at HEAD");
      return Number(match[1]);
    },
  };
}

type Fetch = (url: string) => Promise<Response>;

/** Reads `commit` and `protocol` from a health body; any failure (network, non-JSON) reads as null. */
async function readHealth(url: string, fetcher: Fetch) {
  try {
    const res = await fetcher(url);
    const body = (await res.json()) as { commit?: unknown; protocol?: unknown };
    return {
      commit: typeof body.commit === "string" ? body.commit : null,
      protocol: typeof body.protocol === "number" ? body.protocol : null,
    };
  } catch {
    return { commit: null, protocol: null };
  }
}

const HEALTH_PATH: Record<Service, string> = { web: "/api/health", "race-server": "/health" };

/** Fetches both health endpoints (a 503 body still counts) and returns the verdict against `cwd`'s HEAD. */
export async function run(
  urls: { web: string; race: string },
  opts: { cwd?: string; fetch?: Fetch } = {},
): Promise<Verdict> {
  const cwd = opts.cwd ?? process.cwd();
  const fetcher: Fetch =
    opts.fetch ?? ((url) => fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" }));
  const head = git(cwd, ["rev-parse", "HEAD"]).stdout.trim();
  const tip = git(cwd, ["rev-parse", "--verify", "--quiet", "origin/main"]);
  const main = tip.status === 0 && COMMIT.test(tip.stdout.trim()) ? tip.stdout.trim() : head;
  const base: Record<Service, string> = { web: urls.web, "race-server": urls.race };
  const records: ServiceRecord[] = [];
  for (const service of Object.keys(WATCH_PATHS) as Service[]) {
    const health = await readHealth(
      base[service].replace(/\/+$/, "") + HEALTH_PATH[service],
      fetcher,
    );
    records.push({
      service,
      deployed: health.commit,
      expected: expectedCommit(service, cwd),
      head,
      main,
      protocol: health.protocol,
    });
  }
  return verdict(records, createGit(cwd));
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const web = arg("--web");
  const race = arg("--race");
  if (!web || !race) {
    console.error("usage: npx tsx scripts/deploy-check.ts --web <url> --race <url>");
    process.exit(2);
  }
  void run({ web, race }).then(
    (v) => {
      for (const line of v.lines) console.log(line);
      process.exit(v.ok ? 0 : 1);
    },
    (error: Error) => {
      console.error(error.message);
      process.exit(2);
    },
  );
}
