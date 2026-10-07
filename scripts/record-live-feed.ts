/**
 * Records the landing live feed's loops (bible 7.8, 14.1 item 2; card #552) from the bible's Full Lobby
 * scene, served as `public/3d/lobby.html` by scripts/embeds.ts. No server, no ffmpeg, no new dependency:
 * Playwright's bundled Chromium loads the page from disk (routed under http://localhost) and records in
 * two passes per view.
 *
 *   1. Render pass, deterministic: `Math.random` is seeded (mulberry32) and the page runs on a virtual
 *      clock (own requestAnimationFrame queue and `performance.now`, stepped by exactly 1/FPS s). After
 *      each step the WebGL canvas is copied, with the scene's CSS post (filter + vignette, bible 11.2;
 *      the film grain is left out), into a WebP frame kept in the page.
 *   2. Encode pass, real time: a 2D canvas replays the frames at FPS into MediaRecorder, once as MP4
 *      (H.264) and once as WebM (VP9), with the bitrate sized to the per-file budget and retried lower
 *      while a file is over it (the encoder's rate control is approximate).
 *
 * Seams: FREE VIEW is one full overview orbit (`?orbit=<seconds>`, bible 15) and FIRST PERSON a static
 * camera, so the camera is periodic; the actors are hidden by a CROSSFADE-frame blend of the frames past
 * the end into the first ones. AUTO cuts overview -> first person like the scene does, so its seam is a cut.
 *
 *   npx tsx scripts/record-live-feed.ts            record the three loops and the poster
 *   npx tsx scripts/record-live-feed.ts --only pov record one view (poster comes with auto)
 *   npx tsx scripts/record-live-feed.ts --check    validate inputs and outputs, launch nothing (C7)
 */
import fs from "node:fs";
import path from "node:path";
import { FEED_FORMATS } from "../src/features/landing/feed-media";
import { EMBED_DIR, expectedEmbeds } from "./embeds";

export const OUT_DIR = "public/media/live-feed";
export const SCENE_SOURCE = "docs/design/bible/Fifth Copy Full Lobby.html";
export const ORBIT_HOOK = "get('orbit')";
export const WIDTH = 576;
export const HEIGHT = 720;
export const FPS = 30;
export const CROSSFADE = 15;
export const WARMUP_FRAMES = 60;
export const SEED = 5;
/** C3: each loop <= 1.5 MB, the poster <= 120 kB (`find -size +1536k` / `+120k` count KiB). */
export const MAX_CLIP_BYTES = 1536 * 1024;
export const MAX_POSTER_BYTES = 120 * 1024;
/** Bitrate target: this share of the budget, so the encoder's overshoot still fits. */
export const TARGET_BYTES = 1.35 * 1024 * 1024;
export const POSTER = "poster.webp";

type SceneView = "over" | "pov";
export type Loop = {
  view: "over" | "pov" | "auto";
  crossfade: number;
  segments: { view: SceneView; seconds: number }[];
};

/** FREE VIEW = one 16 s orbit, FIRST PERSON = 12 s, AUTO = 11 s overview then 5 s first person. */
export const LOOPS: readonly Loop[] = [
  { view: "over", crossfade: CROSSFADE, segments: [{ view: "over", seconds: 16 }] },
  { view: "pov", crossfade: CROSSFADE, segments: [{ view: "pov", seconds: 12 }] },
  {
    view: "auto",
    crossfade: 0,
    segments: [
      { view: "over", seconds: 11 },
      { view: "pov", seconds: 5 },
    ],
  },
];

export const loopSeconds = (loop: Loop) => loop.segments.reduce((s, x) => s + x.seconds, 0);
/** The overview orbit period: one turn per FREE VIEW loop. */
export const ORBIT_SECONDS = loopSeconds(LOOPS[0]!);

/** Bits per second that put `seconds` of video at `targetBytes`, scaled down per retry. */
export function bitrateFor(seconds: number, targetBytes = TARGET_BYTES, scale = 1): number {
  return Math.floor(((targetBytes * 8) / seconds) * scale);
}

/** A take with more late frames than this (replay fell behind real time) is recorded again. */
export const MAX_LATE = 3;

/**
 * The bitrate scale of the next take, or null to keep this one: over budget -> 15% lower; late -> same
 * again; a first take far under the target (the encoder undershoots) -> one take scaled up to it.
 */
export function nextTake(bytes: number, late: number, scale: number): number | null {
  if (bytes > MAX_CLIP_BYTES) return scale * 0.85;
  if (late > MAX_LATE) return scale;
  if (scale === 1 && bytes < 0.7 * TARGET_BYTES) return Math.min(2, TARGET_BYTES / bytes);
  return null;
}

export const clipFiles = () =>
  LOOPS.flatMap((loop) => FEED_FORMATS.map(({ ext }) => `${loop.view}.${ext}`));

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  mp4: (b) => b.subarray(4, 8).toString("latin1") === "ftyp",
  webm: (b) => b.subarray(0, 4).toString("hex") === "1a45dfa3",
  webp: (b) =>
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP",
};

/** Problems with the committed outputs: missing files, wrong container, over budget. */
export function validateOutputs(dir: string): string[] {
  const problems: string[] = [];
  const files = [
    ...clipFiles().map((f) => ({ f, max: MAX_CLIP_BYTES })),
    { f: POSTER, max: MAX_POSTER_BYTES },
  ];
  for (const { f, max } of files) {
    const file = path.join(dir, f);
    if (!fs.existsSync(file)) {
      problems.push(`${f}: missing`);
      continue;
    }
    const buf = fs.readFileSync(file);
    const ext = f.split(".").pop()!;
    if (!MAGIC[ext]!(buf)) problems.push(`${f}: not a ${ext} file`);
    if (buf.length > max) problems.push(`${f}: ${buf.length} bytes > ${max}`);
  }
  return problems;
}

/** Problems with the inputs: the served scene drifted from the bible, or lost the orbit hook. */
export function validateInputs(root: string): string[] {
  const problems: string[] = [];
  const lobby = expectedEmbeds(root).find((e) => e.target === "lobby.html")!;
  const served = path.join(root, EMBED_DIR, "lobby.html");
  if (!fs.existsSync(served) || fs.readFileSync(served, "utf8") !== lobby.html)
    problems.push("public/3d/lobby.html is stale (run scripts/embeds.ts)");
  if (!fs.readFileSync(path.join(root, SCENE_SOURCE), "utf8").includes(ORBIT_HOOK))
    problems.push(`${SCENE_SOURCE}: no ?orbit= hook (${ORBIT_HOOK})`);
  return problems;
}

/** Runs in the page before the scene: seeded random, virtual clock, frame capture and the encoder. */
function pageHarness(opts: { seed: number; width: number; height: number; fps: number }) {
  let a = opts.seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const realNow = performance.now.bind(performance);
  let now = 0;
  let queue: [number, FrameRequestCallback][] = [];
  let handle = 0;
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => {
    queue.push([++handle, cb]);
    return handle;
  };
  window.cancelAnimationFrame = (h) => {
    queue = queue.filter(([id]) => id !== h);
  };

  const { width: W, height: H, fps } = opts;
  const frames: Promise<Blob>[] = [];
  const canvas = (w = W, h = H) =>
    Object.assign(document.createElement("canvas"), { width: w, height: h });
  const cap = canvas();
  const capCtx = cap.getContext("2d")!;
  const blob = (c: HTMLCanvasElement, type: string, q: number) =>
    new Promise<Blob>((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error("toBlob"))), type, q));
  const glCanvas = () =>
    [...document.querySelectorAll("canvas")].sort(
      (x, y) => y.width * y.height - x.width * x.height,
    )[0]!;

  function capture() {
    // the scene's CSS post (bible 11.2), baked: `canvas{filter}` and the `.vig` gradient
    capCtx.filter = "sepia(.1) saturate(.92) contrast(1.03)";
    capCtx.drawImage(glCanvas(), 0, 0, W, H);
    capCtx.filter = "none";
    const r = Math.hypot(W, H) / 2;
    const g = capCtx.createRadialGradient(W / 2, H * 0.45, r * 0.62, W / 2, H * 0.45, r);
    g.addColorStop(0, "rgba(24,18,10,0)");
    g.addColorStop(1, "rgba(24,18,10,.32)");
    capCtx.fillStyle = g;
    capCtx.fillRect(0, 0, W, H);
    frames.push(blob(cap, "image/webp", 0.95));
  }

  const toBase64 = (b: Blob) =>
    new Promise<string>((ok) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(",")[1]!);
      r.readAsDataURL(b);
    });

  const rec = {
    started: () => queue.length > 0,
    setView: (view: string) =>
      window.dispatchEvent(new MessageEvent("message", { data: { type: "fc-setview", view } })),
    step(n: number, keep: boolean) {
      for (let i = 0; i < n; i++) {
        now += 1000 / fps;
        const due = queue;
        queue = [];
        for (const [, cb] of due) cb(now);
        if (keep) capture();
      }
      return frames.length;
    },
    supported: (types: string[]) => types.filter((t) => MediaRecorder.isTypeSupported(t)),
    /** Composes the `n` output frames: the first `k` blend in frames n..n+k (the loop seam). */
    async compose(n: number, k: number) {
      const out: Promise<Blob>[] = [];
      const c = canvas();
      const ctx = c.getContext("2d")!;
      for (let i = 0; i < n; i++) {
        if (i >= k) {
          out.push(frames[i]!);
          continue;
        }
        const [head, tail] = await Promise.all(
          [frames[i]!, frames[n + i]!].map(async (f) => createImageBitmap(await f)),
        );
        ctx.globalAlpha = 1;
        ctx.drawImage(head!, 0, 0);
        ctx.globalAlpha = 1 - i / k;
        ctx.drawImage(tail!, 0, 0);
        out.push(blob(c, "image/webp", 0.95));
      }
      frames.length = 0;
      frames.push(...out);
      return frames.length;
    },
    async poster(q: number) {
      const c = canvas();
      c.getContext("2d")!.drawImage(await createImageBitmap(await frames[0]!), 0, 0);
      return toBase64(await blob(c, "image/webp", q));
    },
    /** Replays the frames in real time into MediaRecorder; resolves to the file as base64. */
    async encode(mimeType: string, videoBitsPerSecond: number) {
      const c = canvas();
      const ctx = c.getContext("2d")!;
      const stream = c.captureStream(0);
      const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<void>((ok) => (recorder.onstop = () => ok()));
      const ahead = 12;
      const bitmaps: Promise<ImageBitmap>[] = [];
      const want = (i: number) => {
        if (i < frames.length && !bitmaps[i])
          bitmaps[i] = frames[i]!.then((f) => createImageBitmap(f));
      };
      for (let i = 0; i < ahead; i++) want(i);
      await Promise.all(bitmaps);
      const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, Math.max(0, ms)));
      const frameMs = 1000 / fps;
      let late = 0;
      recorder.start();
      const t0 = realNow();
      for (let i = 0; i < frames.length; i++) {
        want(i + ahead);
        const bmp = await bitmaps[i]!;
        const wait = t0 + i * frameMs - realNow();
        if (wait < -frameMs / 2) late++;
        await sleep(wait);
        ctx.drawImage(bmp, 0, 0);
        track.requestFrame();
        bmp.close();
        delete bitmaps[i];
      }
      await sleep(t0 + frames.length * frameMs - realNow());
      recorder.stop();
      await done;
      track.stop();
      return { data: await toBase64(new Blob(chunks, { type: mimeType })), late };
    },
  };
  (window as unknown as { __rec: typeof rec }).__rec = rec;
}

/** MediaRecorder MIME per container (the `<source type>` of feed-media.ts stays the codec contract). */
const RECORDER_MIME: Record<string, string> = {
  mp4: "video/mp4;codecs=avc1.42E01E",
  webm: "video/webm;codecs=vp9",
};

async function record(only: string[] | null, seed: number) {
  const { chromium } = await import("@playwright/test");
  const root = process.cwd();
  const out = path.join(root, OUT_DIR);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    for (const loop of LOOPS) {
      if (only && !only.includes(loop.view)) continue;
      const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
      page.on("pageerror", (e) => console.error(`[page] ${e.message}`));
      await page.route("http://localhost/**", (route) => {
        const file = path.join(
          root,
          "public",
          decodeURIComponent(new URL(route.request().url()).pathname),
        );
        if (!file.startsWith(path.join(root, "public")) || !fs.existsSync(file))
          return route.fulfill({ status: 404 });
        return route.fulfill({ path: file });
      });
      // tsx keeps function names through a `__name` helper the page does not have
      const opts = JSON.stringify({ seed, width: WIDTH, height: HEIGHT, fps: FPS });
      await page.addInitScript({ content: `var __name = (f) => f; (${pageHarness})(${opts});` });
      const call = <T>(expr: string) => page.evaluate(`window.__rec.${expr}`) as Promise<T>;
      await page.goto(`http://localhost/3d/lobby.html?embed=1&orbit=${ORBIT_SECONDS}`);
      await page.waitForFunction("window.__rec && window.__rec.started()", null, {
        timeout: 120_000,
      });
      const seconds = loopSeconds(loop);
      const n = seconds * FPS;
      const t0 = Date.now();
      await call(`setView(${JSON.stringify(loop.segments[0]!.view)})`);
      await call(`step(${WARMUP_FRAMES}, false)`);
      for (const [i, seg] of loop.segments.entries()) {
        if (i > 0) await call(`setView(${JSON.stringify(seg.view)})`);
        let left = seg.seconds * FPS + (i === loop.segments.length - 1 ? loop.crossfade : 0);
        while (left > 0) {
          const chunk = Math.min(30, left);
          await call(`step(${chunk}, true)`);
          left -= chunk;
        }
      }
      await call(`compose(${n}, ${loop.crossfade})`);
      console.log(
        `${loop.view}: rendered ${n} frames in ${Math.round((Date.now() - t0) / 1000)} s`,
      );

      if (loop.view === "auto") {
        let q = 0.8;
        let buf = Buffer.from(await call<string>(`poster(${q})`), "base64");
        while (buf.length > MAX_POSTER_BYTES && q > 0.4) {
          q -= 0.1;
          buf = Buffer.from(await call<string>(`poster(${q})`), "base64");
        }
        fs.writeFileSync(path.join(out, POSTER), buf);
        console.log(`${POSTER}: ${(buf.length / 1024).toFixed(0)} kB (q ${q.toFixed(1)})`);
      }

      for (const { ext } of FEED_FORMATS) {
        const mime = RECORDER_MIME[ext]!;
        const ok = await call<string[]>(`supported([${JSON.stringify(mime)}])`);
        if (!ok.length) throw new Error(`MediaRecorder cannot record ${mime} in this Chromium`);
        let scale = 1;
        let best: Buffer | null = null;
        for (let attempt = 1; ; attempt++) {
          const bps = bitrateFor(seconds, TARGET_BYTES, scale);
          const { data, late } = await call<{ data: string; late: number }>(
            `encode(${JSON.stringify(mime)}, ${bps})`,
          );
          const buf = Buffer.from(data, "base64");
          console.log(
            `${loop.view}.${ext}: ${(buf.length / 1024).toFixed(0)} kB at ${Math.round(bps / 1000)} kbps` +
              (late ? ` (${late} late frames)` : ""),
          );
          if (buf.length <= MAX_CLIP_BYTES && late <= MAX_LATE) best = buf;
          const next = nextTake(buf.length, late, scale);
          if (next === null || attempt >= 6) {
            if (!best) throw new Error(`${loop.view}.${ext}: no take within budget and on time`);
            fs.writeFileSync(path.join(out, `${loop.view}.${ext}`), best);
            break;
          }
          scale = next;
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const root = process.cwd();
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes("--check")) {
    const problems = [...validateInputs(root), ...validateOutputs(path.join(root, OUT_DIR))];
    if (problems.length) {
      for (const p of problems) console.error(`record-live-feed: ${p}`);
      process.exit(1);
    }
    console.log(
      `record-live-feed: inputs current, ${clipFiles().length} loops + poster within budget`,
    );
    return;
  }
  const inputs = validateInputs(root);
  if (inputs.length) throw new Error(inputs.join("; "));
  const only = arg("--only")?.split(",") ?? null;
  await record(only, Number(arg("--seed") ?? SEED));
  const problems = validateOutputs(path.join(root, OUT_DIR));
  if (problems.length && !only) throw new Error(problems.join("; "));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename))
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
