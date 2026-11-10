import { describe, expect, it } from "vitest";
import { createAudioEngine, type AudioContextLike } from "./engine";

// #243 C2: each buffer is decoded once; `play(name)` starts a BufferSource over the decoded buffer and
// allocates no buffer; `setMuted(true)` stops nothing already playing and drops new plays.

function fakeContext() {
  const calls = { decode: 0, createBuffer: 0, sources: 0, started: 0, stopped: 0, resumed: 0 };
  const sources: { buffer: unknown; started: boolean }[] = [];
  const ctx = {
    state: "running" as AudioContextState,
    destination: { node: "destination" },
    currentTime: 0,
    decodeAudioData: async (data: ArrayBuffer) => {
      calls.decode++;
      return { decoded: data.byteLength } as unknown as AudioBuffer;
    },
    createBuffer: () => {
      calls.createBuffer++;
      return {} as AudioBuffer;
    },
    createBufferSource: () => {
      calls.sources++;
      const source = {
        buffer: null as unknown,
        started: false,
        connect: () => source,
        start: () => {
          calls.started++;
          source.started = true;
        },
        stop: () => {
          calls.stopped++;
        },
      };
      sources.push(source);
      return source;
    },
    resume: async () => {
      calls.resumed++;
    },
  };
  return { ctx: ctx as unknown as AudioContextLike, calls, sources };
}

const fetched: string[] = [];
const fetchBytes = async (url: string) => {
  fetched.push(url);
  return new ArrayBuffer(url.length);
};

describe("#243 C2 createAudioEngine", () => {
  it("decodes each sound once, however often it plays or loads", async () => {
    const { ctx, calls } = fakeContext();
    let made = 0;
    const engine = createAudioEngine(() => (made++, ctx), { fetchBytes, format: "ogg" });
    await engine.load();
    await engine.load();
    for (let i = 0; i < 50; i++) engine.play("clack");
    engine.play("jam");
    engine.play("stamp");
    expect(made).toBe(1);
    expect(calls.decode).toBe(3);
    expect(calls.createBuffer).toBe(0);
  });

  it("play starts a BufferSource over the pooled buffer, no new buffer, no decode", async () => {
    const { ctx, calls, sources } = fakeContext();
    const engine = createAudioEngine(() => ctx, { fetchBytes, format: "ogg" });
    await engine.load();
    const decodes = calls.decode;
    engine.play("clack");
    engine.play("clack");
    expect(calls.decode).toBe(decodes);
    expect(calls.createBuffer).toBe(0);
    expect(calls.started).toBe(2);
    expect(sources[0]!.buffer).toBe(sources[1]!.buffer);
    expect(sources[0]!.buffer).not.toBeNull();
  });

  it("fetches the format it was given from /sounds", async () => {
    fetched.length = 0;
    const { ctx } = fakeContext();
    await createAudioEngine(() => ctx, { fetchBytes, format: "mp3" }).load();
    expect(fetched.sort()).toEqual(["/sounds/clack.mp3", "/sounds/jam.mp3", "/sounds/stamp.mp3"]);
  });

  it("drops a play before its buffer is decoded, and an unknown name", () => {
    const { ctx, calls } = fakeContext();
    const engine = createAudioEngine(() => ctx, { fetchBytes, format: "ogg" });
    engine.play("clack");
    engine.play("nope");
    expect(calls.started).toBe(0);
  });

  it("setMuted(true) stops nothing already playing and drops new plays; false plays again", async () => {
    const { ctx, calls } = fakeContext();
    const engine = createAudioEngine(() => ctx, { fetchBytes, format: "ogg" });
    await engine.load();
    engine.play("stamp");
    engine.setMuted(true);
    expect(calls.stopped).toBe(0);
    engine.play("stamp");
    engine.play("clack");
    expect(calls.started).toBe(1);
    engine.setMuted(false);
    engine.play("clack");
    expect(calls.started).toBe(2);
  });

  it("resumes a suspended context on play (autoplay policy: the next key is the gesture)", async () => {
    const { ctx, calls } = fakeContext();
    (ctx as { state: string }).state = "suspended";
    const engine = createAudioEngine(() => ctx, { fetchBytes, format: "ogg" });
    await engine.load();
    engine.play("clack");
    expect(calls.resumed).toBe(1);
  });

  it("registers another sound with the same play (the #272 extension point)", async () => {
    fetched.length = 0;
    const { ctx, calls } = fakeContext();
    const engine = createAudioEngine(() => ctx, { fetchBytes, format: "ogg" });
    await engine.register("bulb");
    engine.play("bulb");
    expect(fetched).toContain("/sounds/bulb.ogg");
    expect(calls.started).toBe(1);
  });
});
