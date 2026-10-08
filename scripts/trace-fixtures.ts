/**
 * Synthetic keystroke traces for the anti-cheat tables (#195), written to
 * `packages/engine/src/anticheat/fixtures/*.json` and committed as data. No real student data: every
 * trace comes from a seeded model below (mulberry32), so a run regenerates byte-identical files.
 *
 *   npx tsx scripts/trace-fixtures.ts     (re)write the fixtures
 *
 * Human model: log-normal inter-key intervals, faster inside a word (bursts), slower after a space,
 * occasional pauses, about 3 % wrong keys each corrected by Backspace. Scripted models: a constant
 * 50 ms rhythm, 300 WPM with jitter, and a constant rhythm with +-1 ms jitter.
 */
import fs from "node:fs";
import path from "node:path";
import {
  BACKSPACE,
  mulberry32,
  normalizeTypeable,
  replayTrace,
  type EngineSettings,
  type Keystroke,
  type Rng,
} from "@fifth-copy/engine";

export const FIXTURE_DIR = "packages/engine/src/anticheat/fixtures";

const SETTINGS: EngineSettings = { errorMode: "continue", backspace: true };

/** Office words, no names: the fixtures' texts. */
const WORDS = [
  "le",
  "dossier",
  "est",
  "classé",
  "dans",
  "le",
  "tiroir",
  "du",
  "bureau",
  "la",
  "copie",
  "carbone",
  "reste",
  "sur",
  "table",
  "chaque",
  "matin",
  "commis",
  "tape",
  "rapport",
  "en",
  "cinq",
  "exemplaires",
  "pour",
  "service",
  "des",
  "archives",
  "une",
  "lettre",
  "attend",
  "signature",
  "directeur",
  "avant",
  "midi",
  "registre",
  "porte",
  "tampon",
  "rouge",
];

function textOf(rng: Rng, minLength: number): string {
  const words: string[] = [];
  while (words.join(" ").length < minLength) {
    words.push(WORDS[Math.floor(rng() * WORDS.length)]!);
  }
  return normalizeTypeable(words.join(" "));
}

/** Standard normal (Box-Muller). */
function gauss(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

type HumanModel = {
  medianMs: number;
  sigma: number;
  /** Interval factor inside a word (< 1: bursts) and right after a space (> 1). */
  burst: number;
  wordGap: number;
  pauseRate: number;
  errorRate: number;
  minLength: number;
};

function human(rng: Rng, text: string, m: HumanModel): Keystroke[] {
  const keys: Keystroke[] = [];
  let t = 0;
  const step = (factor: number) => {
    t += Math.max(15, Math.round(m.medianMs * factor * Math.exp(m.sigma * gauss(rng))));
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const afterSpace = i > 0 && text[i - 1] === " ";
    let factor = afterSpace ? m.wordGap : ch === " " ? 1 : m.burst;
    if (rng() < m.pauseRate) factor += 2 + 3 * rng();
    if (rng() < m.errorRate) {
      let wrong = ALPHABET[Math.floor(rng() * ALPHABET.length)]!;
      if (wrong === ch) wrong = wrong === "a" ? "b" : "a";
      step(factor);
      keys.push({ t, key: wrong });
      step(1.6);
      keys.push({ t, key: BACKSPACE });
      factor = 1.1;
    }
    step(factor);
    keys.push({ t, key: ch });
  }
  return keys;
}

function steady(text: string, intervalOf: (i: number) => number): Keystroke[] {
  let t = 0;
  return [...text].map((key, i) => {
    t += intervalOf(i);
    return { t, key };
  });
}

type Spec = {
  name: string;
  seed: number;
  build: (rng: Rng) => { text: string; keys: Keystroke[] };
};

const humanSpec = (name: string, seed: number, m: HumanModel): Spec => ({
  name,
  seed,
  build: (rng) => {
    const text = textOf(rng, m.minLength);
    return { text, keys: human(rng, text, m) };
  },
});

export const SPECS: readonly Spec[] = [
  humanSpec("human-1", 1951, {
    medianMs: 190,
    sigma: 0.22,
    burst: 0.95,
    wordGap: 1.1,
    pauseRate: 0,
    errorRate: 0.03,
    minLength: 300,
  }),
  humanSpec("human-2", 1952, {
    medianMs: 230,
    sigma: 0.4,
    burst: 0.85,
    wordGap: 1.3,
    pauseRate: 0.03,
    errorRate: 0.03,
    minLength: 260,
  }),
  humanSpec("human-3", 1953, {
    medianMs: 120,
    sigma: 0.35,
    burst: 0.8,
    wordGap: 1.4,
    pauseRate: 0.02,
    errorRate: 0.03,
    minLength: 400,
  }),
  {
    // 50 ms every key over a short text (~150 chars, ~7.5 s): too regular, yet under the WPM cap
    // because the cap's window is a fixed 10 s.
    name: "scripted-constant",
    seed: 1954,
    build: (rng) => {
      const text = textOf(rng, 150);
      return { text, keys: steady(text, () => 50) };
    },
  },
  {
    // 300 WPM (40 ms mean) with log-normal jitter (CV ~0.3): too fast, not too regular.
    name: "scripted-fast",
    seed: 1955,
    build: (rng) => {
      const text = textOf(rng, 320);
      return {
        text,
        keys: steady(text, () => Math.max(10, Math.round(40 * Math.exp(0.3 * gauss(rng) - 0.045)))),
      };
    },
  },
  {
    // 120 ms +- 1 ms: a script that adds a little noise.
    name: "scripted-jittered",
    seed: 1956,
    build: (rng) => {
      const text = textOf(rng, 150);
      return { text, keys: steady(text, () => 119 + Math.floor(rng() * 3)) };
    },
  },
];

/** JSON with sorted keys, two-space indent and a final newline: byte-stable across runs. */
function stable(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

export function fixtureOf(spec: Spec) {
  const { text, keys } = spec.build(mulberry32(spec.seed));
  const final = replayTrace(keys, text, SETTINGS);
  return {
    seed: spec.seed,
    text,
    settings: SETTINGS,
    keystrokes: keys,
    recorded: { cursor: final.cursor, correct: final.correct, errors: final.errors },
    timingAnomalies: 0,
  };
}

function main() {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const spec of SPECS) {
    fs.writeFileSync(path.join(FIXTURE_DIR, `${spec.name}.json`), stable(fixtureOf(spec)));
  }
  console.log(`wrote ${SPECS.length} fixtures to ${FIXTURE_DIR}`);
}

main();
