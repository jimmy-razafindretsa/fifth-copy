/**
 * The race's sound set (#243, R50, R76; bible 2 "classroom-friendly"): `public/sounds/{clack,jam,stamp}`
 * as Ogg Vorbis plus an MP3 fallback, synthesised here from seeded noise and sine partials, so the set is
 * an original work of this repository, dedicated to the public domain (CC0 1.0) and listed in
 * `public/sounds/LICENSES.md`. Deterministic: the same script writes the same samples.
 *
 *   npx tsx scripts/sounds.ts      (needs ffmpeg with libvorbis and libmp3lame on the PATH)
 *
 * The files are short and quiet (peak -6 dBFS): a classroom of 30 desks clacking at once stays a murmur.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RATE = 22_050;
const PEAK = 0.5; // -6 dBFS

/** Mulberry32: a seeded PRNG, so a regenerated file is the same file. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A one-pole band of white noise: a high-pass then a low-pass, for the clatter's colour. */
function noise(seed: number, n: number, lowHz: number, highHz: number): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(n);
  const hp = Math.exp((-2 * Math.PI * lowHz) / RATE);
  const lp = 1 - Math.exp((-2 * Math.PI * highHz) / RATE);
  let prevIn = 0;
  let prevHp = 0;
  let prevLp = 0;
  for (let i = 0; i < n; i++) {
    const x = r() * 2 - 1;
    const h = hp * (prevHp + x - prevIn);
    prevIn = x;
    prevHp = h;
    prevLp += lp * (h - prevLp);
    out[i] = prevLp;
  }
  return out;
}

type Layer = { at: number; sig: (t: number, i: number) => number; decay: number; gain: number };

/** Sums the layers (each `at` s in, decaying by `decay` s) and normalises to PEAK with a 2 ms fade-out. */
function render(seconds: number, layers: Layer[]): Float32Array {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  for (const { at, sig, decay, gain } of layers) {
    const start = Math.round(at * RATE);
    for (let i = start; i < n; i++) {
      const t = (i - start) / RATE;
      out[i]! += gain * Math.exp(-t / decay) * sig(t, i - start);
    }
  }
  const max = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const fade = Math.round(0.002 * RATE);
  for (let i = 0; i < n; i++) {
    const tail = Math.min(1, (n - 1 - i) / fade);
    out[i] = (out[i]! / max) * PEAK * tail;
  }
  return out;
}

const sine = (hz: number) => (t: number) => Math.sin(2 * Math.PI * hz * t);

function sounds(): Record<"clack" | "jam" | "stamp", Float32Array> {
  const N = RATE; // one second of noise is more than any sound needs
  const tick = noise(11, N, 1_800, 6_000);
  const body = noise(12, N, 300, 1_400);
  const grit = noise(13, N, 120, 900);
  const thud = noise(14, N, 40, 300);
  return {
    // a type bar on the platen: a bright tick, the key's wooden body, a short low knock
    clack: render(0.09, [
      { at: 0, sig: (_, i) => tick[i]!, decay: 0.006, gain: 1 },
      { at: 0.002, sig: (_, i) => body[i]!, decay: 0.014, gain: 0.7 },
      { at: 0, sig: sine(170), decay: 0.012, gain: 0.35 },
    ]),
    // the bars lock: two quick clunks and a dull metal buzz that dies
    jam: render(0.26, [
      { at: 0, sig: (_, i) => grit[i]!, decay: 0.02, gain: 1 },
      { at: 0.045, sig: (_, i) => grit[i + 2_000]!, decay: 0.025, gain: 0.8 },
      {
        at: 0.01,
        sig: (t) => Math.sign(Math.sin(2 * Math.PI * 92 * t)) * 0.6 + sine(184)(t) * 0.4,
        decay: 0.07,
        gain: 0.35,
      },
    ]),
    // the rubber stamp lands: a low thump, the pad's slap, the desk's short ring
    stamp: render(0.24, [
      { at: 0, sig: sine(68), decay: 0.05, gain: 1 },
      { at: 0, sig: (_, i) => thud[i]!, decay: 0.03, gain: 0.9 },
      { at: 0.001, sig: (_, i) => body[i + 5_000]!, decay: 0.012, gain: 0.5 },
      { at: 0.004, sig: sine(240), decay: 0.04, gain: 0.12 },
    ]),
  };
}

/** 16-bit mono PCM WAV. */
function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) =>
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2),
  );
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

function main() {
  const out = path.resolve("public/sounds");
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-sounds-"));
  for (const [name, samples] of Object.entries(sounds())) {
    const src = path.join(tmp, `${name}.wav`);
    fs.writeFileSync(src, wav(samples));
    const ff = ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-map_metadata", "-1"];
    execFileSync("ffmpeg", [
      ...ff,
      "-c:a",
      "libvorbis",
      "-q:a",
      "3",
      path.join(out, `${name}.ogg`),
    ]);
    execFileSync("ffmpeg", [
      ...ff,
      "-c:a",
      "libmp3lame",
      "-b:a",
      "64k",
      path.join(out, `${name}.mp3`),
    ]);
    console.log(`sounds: ${name} ${(samples.length / RATE).toFixed(2)} s`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

main();
