/**
 * Creates an epic and its cards in Linear from a plan file, then sets `blocks` relations and runs dag_check.
 * Idempotent: linear.ts create searches by title (+epic) first and never duplicates.
 *   npx tsx scripts/linear-seed.ts work/plan/foundations.json [--dry-run | --validate]
 *   --validate runs the Analyst self-check offline (no Linear calls).
 * Cards land in Backlog. A human adds `plan-approved` to the epic; Picker promotes cards to Ready.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contractHash, parseContract } from "./lib/kit";

type PlanCard = {
  key: string;
  title: string;
  labels: string[];
  estimate: number;
  priority: number;
  blockedBy: string[];
  body: string;
};
type Plan = {
  epic: { title: string; labels: string[]; priority: number; body: string };
  cards: PlanCard[];
};

const file = process.argv[2];
const dry = process.argv.includes("--dry-run");
if (!file) {
  console.error("usage: linear-seed.ts <plan.json> [--dry-run]");
  process.exit(2);
}
const plan = JSON.parse(fs.readFileSync(file, "utf8")) as Plan;

// Analyst self-check (agents/roles/analyst.md step 12) before touching Linear.
const keys = new Set(plan.cards.map((c) => c.key));
const problems: string[] = [];
for (const c of plan.cards) {
  if (c.estimate > 3) problems.push(`${c.key}: estimate > 3`);
  if (!contractHash(c.body)) problems.push(`${c.key}: no ## Contract`);
  const crit = parseContract(c.body);
  if (!crit.length) problems.push(`${c.key}: contract has no C# criteria`);
  if (crit.some((x) => !x.verify) && !c.labels.includes("autonomy:hitl"))
    problems.push(`${c.key}: criterion without verify target must be autonomy:hitl`);
  if (c.labels.includes("ui") && !/## UI\n(?!none)/.test(c.body))
    problems.push(`${c.key}: ui card needs states/viewports in ## UI`);
  if (c.labels.includes("touches:prisma") && !/additive|breaking/.test(c.body))
    problems.push(`${c.key}: touches:prisma must state additive or breaking`);
  for (const b of c.blockedBy) if (!keys.has(b)) problems.push(`${c.key}: unknown blocker ${b}`);
}
if (problems.length) {
  for (const p of problems) console.error(`plan: ${p}`);
  process.exit(1);
}
console.log(`plan: ok (${plan.cards.length} cards, self-check passed)`);
if (process.argv.includes("--validate")) process.exit(0);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "linear-seed-"));
function linear(args: string[]): string {
  let out: string;
  try {
    out = run(args);
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string };
    console.error(
      `seed: stopped at \`linear ${args[0]}\`: ${(err.stderr || err.stdout || String(e)).trim()}`,
    );
    process.exit(1);
  }
  process.stdout.write(
    out
      .split("\n")
      .filter((l) => l && !l.startsWith("{") && !l.startsWith(" "))
      .map((l) => `${l}\n`)
      .join(""),
  );
  return out;
}
function run(args: string[]): string {
  return execFileSync("npx", ["tsx", "scripts/linear.ts", ...args, ...(dry ? ["--dry-run"] : [])], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function idFrom(out: string, fallback: string): string {
  return /(?:created|exists): ([A-Z]+-\d+)/.exec(out)?.[1] ?? fallback;
}
function create(
  title: string,
  body: string,
  labels: string[],
  priority: number,
  extra: string[] = [],
) {
  const f = path.join(tmp, `${title.replace(/\W+/g, "_").slice(0, 40)}.md`);
  fs.writeFileSync(f, body);
  return linear([
    "create",
    "--title",
    title,
    "--body-file",
    f,
    "--labels",
    labels.join(","),
    "--priority",
    String(priority),
    "--create-missing",
    ...extra,
  ]);
}

const epicId = idFrom(
  create(plan.epic.title, plan.epic.body, plan.epic.labels, plan.epic.priority),
  "EPIC",
);
const ids = new Map<string, string>();
for (const c of plan.cards) {
  const out = create(c.title, c.body, c.labels, c.priority, [
    "--parent",
    epicId,
    "--estimate",
    String(c.estimate),
  ]);
  ids.set(c.key, idFrom(out, `<${c.key}>`));
}
for (const c of plan.cards)
  for (const b of c.blockedBy) linear(["relate", ids.get(b)!, "blocks", ids.get(c.key)!]);
if (!dry) linear(["dag_check", epicId]);
console.log(
  `\nseed: epic ${epicId}, ${plan.cards.length} cards. Human: add label plan-approved to ${epicId} to let Picker promote cards.`,
);
fs.rmSync(tmp, { recursive: true, force: true });
