import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_IMAGE_TIMEOUT_MS,
  ProviderImageError,
  fetchProviderImage,
} from "./fetch-provider-image";
import { FsAvatarStore } from "./fs-store";
import type { AvatarModerator, ModerationVerdict } from "./moderation/moderator";
import type { OauthAvatarUsers } from "./oauth-avatar-users";
import {
  OAUTH_AVATAR_WARNING,
  importOauthAvatar,
  type ImportOauthAvatarDeps,
  type OauthAvatarWarn,
} from "./import-oauth-avatar";
import { MAX_AVATAR_BYTES } from "./store-avatar";

// Network is never real here: every test injects a fake `fetch` returning WHATWG Responses.
const GITHUB = "https://avatars.githubusercontent.com/u/123?v=4";
const DISCORD = "https://cdn.discordapp.com/avatars/42/abc.png";
const USER = "user1";

const png = (width = 300, height = 200) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .png()
    .toBuffer();

type FakeFetch = ReturnType<typeof vi.fn<typeof fetch>>;

/** A moderator with a fixed verdict (ADR 0015); the real ones are tested in moderation/. */
const always = (verdict: ModerationVerdict): AvatarModerator => ({
  check: async () => ({ verdict, reason: "clear" }),
});

function imageResponse(body: BodyInit | null, headers: Record<string, string> = {}, status = 200) {
  return new Response(body, { status, headers: { "content-type": "image/png", ...headers } });
}

/** A body that hands out `chunks` chunks of `size` bytes, counting how many were pulled. */
function chunkedBody(chunks: number, size: number) {
  const pulled = { count: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.count >= chunks) return controller.close();
      pulled.count++;
      controller.enqueue(new Uint8Array(size));
    },
    cancel() {
      pulled.cancelled = true;
    },
  });
  return { stream, pulled };
}

const never = () => new Promise<never>(() => undefined);

describe("fetchProviderImage (SSRF guard, C1)", () => {
  afterEach(() => vi.useRealTimers());

  it("fetches an allowlisted https URL without following redirects or sending credentials", async () => {
    const bytes = await png();
    const fake: FakeFetch = vi.fn(async () => imageResponse(bytes));
    const out = await fetchProviderImage(GITHUB, { fetch: fake });
    expect(Buffer.from(out).equals(bytes)).toBe(true);
    expect(fake).toHaveBeenCalledTimes(1);
    const [url, init] = fake.mock.calls[0]!;
    expect(url).toBe(GITHUB);
    expect(init).toMatchObject({ redirect: "error", credentials: "omit" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("accepts the Discord CDN", async () => {
    const fake: FakeFetch = vi.fn(async () => imageResponse(await png()));
    await expect(fetchProviderImage(DISCORD, { fetch: fake })).resolves.toBeInstanceOf(Uint8Array);
  });

  it.each([
    ["a non-provider host", "https://evil.example/a.png"],
    ["plain http", "http://avatars.githubusercontent.com/u/1"],
    ["userinfo before the host", "https://avatars.githubusercontent.com@evil.example/a.png"],
    ["userinfo on an allowed host", "https://user:pw@cdn.discordapp.com/avatars/1/a.png"],
    ["a custom port", "https://cdn.discordapp.com:8443/avatars/1/a.png"],
    ["a lookalike subdomain", "https://avatars.githubusercontent.com.evil.example/a.png"],
    ["a trailing-dot host", "https://cdn.discordapp.com./avatars/1/a.png"],
    ["an IP literal", "https://169.254.169.254/latest/meta-data"],
    ["an IPv6 literal", "https://[::1]/a.png"],
    ["localhost", "https://localhost/a.png"],
    ["a file URL", "file:///etc/passwd"],
    ["a data URL", "data:image/png;base64,AAAA"],
    ["garbage", "not a url"],
  ])("refuses %s before any request", async (_label, url) => {
    const fake: FakeFetch = vi.fn(async () => imageResponse(await png()));
    await expect(fetchProviderImage(url, { fetch: fake })).rejects.toMatchObject({
      reason: "host",
    });
    expect(fake).not.toHaveBeenCalled();
  });

  it.each([301, 302, 307, 308])("refuses a %i redirect response", async (status) => {
    const fake: FakeFetch = vi.fn(
      async () => new Response(null, { status, headers: { location: "https://169.254.169.254/" } }),
    );
    await expect(fetchProviderImage(GITHUB, { fetch: fake })).rejects.toMatchObject({
      reason: "fetch",
    });
  });

  it("maps a network error (incl. fetch's own redirect refusal) to fetch", async () => {
    const fake: FakeFetch = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
    });
    await expect(fetchProviderImage(GITHUB, { fetch: fake })).rejects.toMatchObject({
      reason: "fetch",
    });
  });

  it("refuses a non-2xx status", async () => {
    const fake: FakeFetch = vi.fn(async () => imageResponse(await png(), {}, 404));
    await expect(fetchProviderImage(GITHUB, { fetch: fake })).rejects.toMatchObject({
      reason: "fetch",
    });
  });

  it.each([["text/html"], ["application/octet-stream"], [""], ["imagex/png"]])(
    "refuses content type %j",
    async (type) => {
      const fake: FakeFetch = vi.fn(
        async () => new Response(await png(), { headers: { "content-type": type } }),
      );
      await expect(fetchProviderImage(GITHUB, { fetch: fake })).rejects.toMatchObject({
        reason: "type",
      });
    },
  );

  it("refuses a declared Content-Length over 5 MB without reading the body", async () => {
    const { stream, pulled } = chunkedBody(10, 1024);
    const fake: FakeFetch = vi.fn(async () =>
      imageResponse(stream, { "content-length": String(MAX_AVATAR_BYTES + 1) }),
    );
    await expect(fetchProviderImage(GITHUB, { fetch: fake })).rejects.toMatchObject({
      reason: "too-large",
    });
    expect(pulled.count).toBeLessThanOrEqual(1);
  });

  it("stops reading once the streamed body passes 5 MB (header absent or lying)", async () => {
    const chunk = 512 * 1024;
    const { stream, pulled } = chunkedBody(100, chunk);
    const fake: FakeFetch = vi.fn(async () => imageResponse(stream, { "content-length": "10" }));
    await expect(fetchProviderImage(GITHUB, { fetch: fake })).rejects.toMatchObject({
      reason: "too-large",
    });
    expect(pulled.count).toBeLessThanOrEqual(MAX_AVATAR_BYTES / chunk + 2);
    expect(pulled.cancelled).toBe(true);
  });

  it("accepts exactly 5 MB", async () => {
    const { stream } = chunkedBody(5, 1024 * 1024);
    const fake: FakeFetch = vi.fn(async () => imageResponse(stream));
    const out = await fetchProviderImage(GITHUB, { fetch: fake });
    expect(out.byteLength).toBe(MAX_AVATAR_BYTES);
  });

  it("times out after 5 s when the headers never come", async () => {
    expect(PROVIDER_IMAGE_TIMEOUT_MS).toBe(5000);
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fake: FakeFetch = vi.fn((_url, init) => {
      signal = init?.signal ?? undefined;
      return never();
    });
    const result = fetchProviderImage(GITHUB, { fetch: fake }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(4999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ reason: "timeout" });
    expect(signal?.aborted).toBe(true);
  });

  it("the same 5 s budget covers a body that stalls (slow loris)", async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(10));
      },
      pull: () => never(),
    });
    const fake: FakeFetch = vi.fn(async () => imageResponse(stream));
    const result = fetchProviderImage(GITHUB, { fetch: fake }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5000);
    const error = await result;
    expect(error).toBeInstanceOf(ProviderImageError);
    expect(error).toMatchObject({ reason: "timeout" });
  });

  it("errors carry the reason code only, never the URL", async () => {
    const fake: FakeFetch = vi.fn(async () => new Response("x", { status: 500 }));
    const error = await fetchProviderImage(GITHUB, { fetch: fake }).catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toContain("githubusercontent");
    expect(JSON.stringify(error)).not.toContain("githubusercontent");
  });
});

describe("importOauthAvatar", () => {
  let root: string;
  let store: FsAvatarStore;
  let row: { avatarKey: string | null; avatarStatus: string };
  let users: {
    hasAvatar: ReturnType<typeof vi.fn<OauthAvatarUsers["hasAvatar"]>>;
    setAvatarIfNone: ReturnType<typeof vi.fn<OauthAvatarUsers["setAvatarIfNone"]>>;
  };
  let warn: ReturnType<typeof vi.fn<OauthAvatarWarn>>;
  const files = async () => (await readdir(path.join(root, USER)).catch(() => [])).sort();

  const run = (
    url: string | null | undefined,
    fake: FakeFetch,
    extra: ImportOauthAvatarDeps = {},
  ) =>
    importOauthAvatar(USER, url, {
      fetch: fake,
      store,
      moderator: always("approve"),
      users,
      warn,
      now: () => 1_700_000_000_000,
      ...extra,
    });

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "fc-oauth-avatar-"));
    store = new FsAvatarStore(root);
    row = { avatarKey: null, avatarStatus: "NONE" };
    users = {
      hasAvatar: vi.fn<OauthAvatarUsers["hasAvatar"]>(async () => row.avatarKey !== null),
      setAvatarIfNone: vi.fn<OauthAvatarUsers["setAvatarIfNone"]>(async (_id, avatar) => {
        if (row.avatarKey !== null) return false;
        row = { avatarKey: avatar.key, avatarStatus: avatar.status };
        return true;
      }),
    };
    warn = vi.fn<OauthAvatarWarn>();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  it("C1: stores the provider picture through storeAvatar and sets avatarKey and status", async () => {
    const fake: FakeFetch = vi.fn(async () => imageResponse(await png(300, 200)));
    const result = await run(GITHUB, fake);
    expect(result).toEqual({ imported: true, key: "user1/1700000000000" });
    expect(row).toEqual({ avatarKey: "user1/1700000000000", avatarStatus: "APPROVED" });
    expect(users.setAvatarIfNone).toHaveBeenCalledWith(USER, {
      key: "user1/1700000000000",
      status: "APPROVED",
    });
    expect(await files()).toEqual(["1700000000000-256.webp", "1700000000000-64.webp"]);
    for (const size of [256, 64] as const) {
      const meta = await sharp((await store.get(USER, 1_700_000_000_000, size))!).metadata();
      expect(meta).toMatchObject({ format: "webp", width: size, height: size });
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("C1: metadata in the provider picture is stripped", async () => {
    const tagged = await sharp(await png(200, 200))
      .jpeg()
      .withExif({ IFD0: { Artist: "provider-secret" } })
      .toBuffer();
    const fake: FakeFetch = vi.fn(async () =>
      imageResponse(tagged, { "content-type": "image/jpeg" }),
    );
    await run(DISCORD, fake);
    const out = (await store.get(USER, 1_700_000_000_000, 256))!;
    expect(out.includes("provider-secret")).toBe(false);
  });

  describe("C2: failures leave the default portrait, resolve, and warn without personal data", () => {
    const cases: [string, string, () => FakeFetch][] = [
      ["host", "https://evil.example/a.png", () => vi.fn(async () => imageResponse(null))],
      [
        "fetch",
        GITHUB,
        () =>
          vi.fn(async () => {
            throw new TypeError(`fetch failed for ${GITHUB}`);
          }),
      ],
      ["fetch", GITHUB, () => vi.fn(async () => new Response(null, { status: 302 }))],
      [
        "type",
        GITHUB,
        () =>
          vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } })),
      ],
      [
        "too-large",
        GITHUB,
        () => vi.fn(async () => imageResponse(chunkedBody(20, 512 * 1024).stream)),
      ],
      [
        "image",
        GITHUB,
        () =>
          vi.fn(async () =>
            imageResponse('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"/>', {
              "content-type": "image/svg+xml",
            }),
          ),
      ],
      ["image", GITHUB, () => vi.fn(async () => imageResponse(Buffer.from("not an image")))],
    ];

    it.each(cases)("%s", async (reason, url, make) => {
      const result = await run(url, make());
      expect(result).toEqual({ imported: false, reason });
      expect(row).toEqual({ avatarKey: null, avatarStatus: "NONE" });
      expect(await readdir(root)).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(OAUTH_AVATAR_WARNING, { reason });
      const logged = JSON.stringify(warn.mock.calls);
      for (const secret of [url, new URL(url).hostname, USER, "githubusercontent"]) {
        expect(logged).not.toContain(secret);
      }
    });

    it("image: a picture under 64 px", async () => {
      const small = await png(40, 40);
      const result = await run(
        GITHUB,
        vi.fn(async () => imageResponse(small)),
      );
      expect(result).toEqual({ imported: false, reason: "image" });
      expect(row.avatarKey).toBeNull();
    });

    it("timeout: a provider that never answers within 5 s", async () => {
      vi.useFakeTimers();
      const result = run(GITHUB, vi.fn(never));
      await vi.advanceTimersByTimeAsync(PROVIDER_IMAGE_TIMEOUT_MS);
      expect(await result).toEqual({ imported: false, reason: "timeout" });
      expect(row.avatarKey).toBeNull();
      expect(warn).toHaveBeenCalledWith(OAUTH_AVATAR_WARNING, { reason: "timeout" });
    });

    it("an unexpected error (database down) still resolves", async () => {
      users.hasAvatar.mockRejectedValue(new Error(`db down for ${USER}`));
      const result = await run(
        GITHUB,
        vi.fn(async () => imageResponse(await png())),
      );
      expect(result).toEqual({ imported: false, reason: "error" });
      expect(warn).toHaveBeenCalledWith(OAUTH_AVATAR_WARNING, { reason: "error" });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(USER);
    });

    it("a commit failure removes the stored files", async () => {
      users.setAvatarIfNone.mockRejectedValue(new Error("db down"));
      const result = await run(
        GITHUB,
        vi.fn(async () => imageResponse(await png())),
      );
      expect(result).toEqual({ imported: false, reason: "error" });
      expect(await files()).toEqual([]);
    });

    it("an invalid user id resolves without touching anything", async () => {
      const fake: FakeFetch = vi.fn(async () => imageResponse(await png()));
      const result = await importOauthAvatar("../etc", GITHUB, { fetch: fake, store, users, warn });
      expect(result).toEqual({ imported: false, reason: "error" });
      expect(await readdir(root)).toEqual([]);
    });

    it.each([[null], [undefined], [""]])(
      "no provider picture (%j) is a silent skip",
      async (url) => {
        const fake: FakeFetch = vi.fn();
        expect(await run(url, fake)).toEqual({ imported: false, reason: "no-url" });
        expect(fake).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
      },
    );
  });

  describe("moderation (ADR 0015, #64): imports pass the same check as uploads", () => {
    it("a flagged picture is stored PENDING", async () => {
      const fake: FakeFetch = vi.fn(async () => imageResponse(await png(200, 200)));
      const result = await run(GITHUB, fake, { moderator: always("flag") });
      expect(result).toEqual({ imported: true, key: "user1/1700000000000" });
      expect(row).toEqual({ avatarKey: "user1/1700000000000", avatarStatus: "PENDING" });
      expect(await files()).toHaveLength(2);
    });

    it("a rejected picture is skipped: nothing written, default portrait stays", async () => {
      const fake: FakeFetch = vi.fn(async () => imageResponse(await png(200, 200)));
      const result = await run(GITHUB, fake, { moderator: always("reject") });
      expect(result).toEqual({ imported: false, reason: "rejected" });
      expect(row).toEqual({ avatarKey: null, avatarStatus: "NONE" });
      expect(users.setAvatarIfNone).not.toHaveBeenCalled();
      expect(await readdir(root)).toEqual([]);
      expect(warn).toHaveBeenCalledWith(OAUTH_AVATAR_WARNING, { reason: "rejected" });
    });
  });

  describe("C3: never overwrites a stored avatar", () => {
    it("skips without fetching when the user already has an avatar", async () => {
      row = { avatarKey: "user1/1600000000000", avatarStatus: "APPROVED" };
      const fake: FakeFetch = vi.fn(async () => imageResponse(await png()));
      expect(await run(GITHUB, fake)).toEqual({ imported: false, reason: "has-avatar" });
      expect(fake).not.toHaveBeenCalled();
      expect(users.setAvatarIfNone).not.toHaveBeenCalled();
      expect(row).toEqual({ avatarKey: "user1/1600000000000", avatarStatus: "APPROVED" });
      expect(warn).not.toHaveBeenCalled();
    });

    it("a second sign-in after the import is a no-op", async () => {
      const fake: FakeFetch = vi.fn(async () => imageResponse(await png()));
      await run(GITHUB, fake);
      const first = { ...row };
      expect(await run(GITHUB, fake, { now: () => 1_800_000_000_000 })).toEqual({
        imported: false,
        reason: "has-avatar",
      });
      expect(row).toEqual(first);
      expect(fake).toHaveBeenCalledTimes(1);
    });

    it("race: a picture chosen during the import wins and the import's files are deleted", async () => {
      // The user uploads between the has-avatar check and the commit.
      const chosen = new FsAvatarStore(root);
      const fake: FakeFetch = vi.fn(async () => {
        await chosen.put(USER, 1_650_000_000_000, {
          256: Buffer.from("chosen-256"),
          64: Buffer.from("chosen-64"),
        });
        row = { avatarKey: "user1/1650000000000", avatarStatus: "APPROVED" };
        return imageResponse(await png());
      });
      const result = await run(GITHUB, fake);
      expect(result).toEqual({ imported: false, reason: "raced" });
      expect(row).toEqual({ avatarKey: "user1/1650000000000", avatarStatus: "APPROVED" });
      expect(await files()).toEqual(["1650000000000-256.webp", "1650000000000-64.webp"]);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
