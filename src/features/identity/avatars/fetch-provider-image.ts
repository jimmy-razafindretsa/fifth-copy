import { MAX_AVATAR_BYTES } from "./store-avatar";

// Server-side fetch of an OAuth provider's profile picture (#52). The URL comes from the provider's
// profile, i.e. from the network, so it is an SSRF surface: only https, only the two provider CDNs
// by exact host, default port, no userinfo, no redirects, one deadline for headers and body, and a
// byte cap enforced on the stream (the Content-Length header is a hint, never trusted alone).

/** Exact hostnames (no suffix match). A constant, not env: widening it is a code review. */
export const PROVIDER_IMAGE_HOSTS: readonly string[] = [
  "avatars.githubusercontent.com",
  "cdn.discordapp.com",
];
export const PROVIDER_IMAGE_TIMEOUT_MS = 5000;

export type ProviderImageFailure = "host" | "fetch" | "timeout" | "too-large" | "type";

/** Carries a reason code only: never the URL, a header or the underlying error's message. */
export class ProviderImageError extends Error {
  constructor(readonly reason: ProviderImageFailure) {
    super(`Provider image refused: ${reason}`);
  }
  override get name() {
    return "ProviderImageError";
  }
}

export type FetchProviderImageOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
};

/** The parsed URL when it may be fetched; otherwise throws `host`. */
export function assertProviderImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderImageError("host");
  }
  const ok =
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    PROVIDER_IMAGE_HOSTS.includes(url.hostname);
  if (!ok) throw new ProviderImageError("host");
  return url;
}

export async function fetchProviderImage(
  raw: string,
  options: FetchProviderImageOptions = {},
): Promise<Uint8Array> {
  const url = assertProviderImageUrl(raw);
  const doFetch = options.fetch ?? globalThis.fetch;
  const maxBytes = options.maxBytes ?? MAX_AVATAR_BYTES;

  // One deadline for the whole exchange. The race below makes it hold even if the fetch
  // implementation or the body stream ignores the abort signal.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? PROVIDER_IMAGE_TIMEOUT_MS,
  );
  const deadline = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new ProviderImageError("timeout")), {
      once: true,
    });
  });
  deadline.catch(() => undefined);
  const guard = <T>(work: Promise<T>, failure: ProviderImageFailure) =>
    Promise.race([work, deadline]).catch((error: unknown) => {
      if (controller.signal.aborted) throw new ProviderImageError("timeout");
      if (error instanceof ProviderImageError) throw error;
      throw new ProviderImageError(failure);
    });

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await guard(
      doFetch(url.href, {
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        headers: { accept: "image/*" },
        signal: controller.signal,
      }),
      "fetch",
    );
    if (response.type === "opaqueredirect" || response.redirected || !response.ok) {
      throw new ProviderImageError("fetch");
    }
    const type = (response.headers.get("content-type") ?? "").trim().toLowerCase();
    if (!type.startsWith("image/")) throw new ProviderImageError("type");
    const declared = Number(response.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared > maxBytes) throw new ProviderImageError("too-large");
    if (!response.body) throw new ProviderImageError("fetch");

    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await guard(reader.read(), "fetch");
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new ProviderImageError("too-large");
      chunks.push(value);
    }
    reader = undefined;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  } catch (error) {
    controller.abort();
    void reader?.cancel().catch(() => undefined);
    throw error instanceof ProviderImageError ? error : new ProviderImageError("fetch");
  } finally {
    clearTimeout(timer);
  }
}
