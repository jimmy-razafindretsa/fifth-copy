import { SOUND_NAMES, soundUrl } from "./sounds";

/**
 * The race's audio engine (#243, ADR 0013): Web Audio, no library. Loaded only by `import()` on the first
 * unmute (`start.ts`), so no audio code or file is in the race route's first load. Each sound is fetched
 * and decoded once into a pool of `AudioBuffer`s; `play(name)` starts a one-shot `BufferSource` over the
 * pooled buffer (Web Audio's sources are single-use and cheap; no buffer is allocated, nothing decoded),
 * so a keystroke costs one node. Muted, it drops new plays and leaves a sound already playing to end.
 * Single responsibility: play named sounds; what plays when is `hooks.ts`'s (`bindSounds`).
 */

/** The parts of `AudioContext` the engine uses (a fake one in tests). */
export type AudioContextLike = Pick<
  BaseAudioContext,
  "decodeAudioData" | "createBufferSource" | "destination" | "state"
> & { resume(): Promise<void> };

export type AudioEngine = {
  /** Fetches and decodes the sound set once (later calls wait on the same work). */
  load(): Promise<void>;
  /** Adds a named sound (`/sounds/<name>.<format>`) to the pool: #272's `bulb`. */
  register(name: string): Promise<void>;
  /** Plays a decoded sound; drops it while muted, before its buffer is ready, or for an unknown name. */
  play(name: string): void;
  setMuted(muted: boolean): void;
};

export type AudioEngineOptions = {
  /** The bytes of a sound file (`fetch` by default). */
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  /** The file format the browser decodes (`pickFormat` by default). */
  format?: "ogg" | "mp3";
};

/** Ogg Vorbis where the browser plays it, else the MP3 fallback (Safari before 17). */
export function pickFormat(): "ogg" | "mp3" {
  if (typeof Audio === "undefined") return "mp3";
  return new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
}

const fetchArrayBuffer = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sound ${url}: ${res.status}`);
  return res.arrayBuffer();
};

export function createAudioEngine(
  ctxFactory: () => AudioContextLike,
  { fetchBytes = fetchArrayBuffer, format }: AudioEngineOptions = {},
): AudioEngine {
  let ctx: AudioContextLike | null = null;
  let muted = false;
  const buffers = new Map<string, AudioBuffer>();
  const loading = new Map<string, Promise<void>>();
  const context = () => (ctx ??= ctxFactory());

  const register = (name: string) => {
    const known = loading.get(name);
    if (known) return known;
    const ac = context();
    const work = fetchBytes(soundUrl(name, format ?? pickFormat()))
      .then((bytes) => ac.decodeAudioData(bytes))
      .then((buffer) => void buffers.set(name, buffer));
    // a failed file stays silent (and may be retried), never breaks the race
    loading.set(
      name,
      work.catch(() => void loading.delete(name)),
    );
    return loading.get(name)!;
  };

  return {
    load: () => Promise.all(SOUND_NAMES.map(register)).then(() => undefined),
    register,
    play(name) {
      if (muted || !ctx) return;
      const buffer = buffers.get(name);
      if (!buffer) return;
      // autoplay policy: a context made outside a gesture starts suspended; a keystroke is a gesture
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
    },
    setMuted(next) {
      muted = next;
    },
  };
}
