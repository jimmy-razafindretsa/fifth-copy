/** Where a sign-in lands when no safe `callbackUrl` was given. */
export const DEFAULT_CALLBACK = "/";

const MAX_LENGTH = 512;

/**
 * The redirect target after sign-in (#36 C5): `raw` only when it is a same-origin path, else `/`. A path
 * starts with one `/` and is not `//` or `/\` (protocol-relative: another host), holds no scheme, no
 * backslash and no control or whitespace character (browsers strip tabs and newlines, which would turn
 * `/\t/evil` into `//evil`), and is at most 512 characters. Pure, so the proxy and the action share it.
 */
export function safeCallbackUrl(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH)
    return DEFAULT_CALLBACK;
  if (!raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_CALLBACK;
  if (/[\\\s\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_CALLBACK;
  // A parse against a dummy origin must keep that origin: catches anything the checks above missed.
  try {
    const url = new URL(raw, "http://fifth-copy.invalid");
    if (url.origin !== "http://fifth-copy.invalid") return DEFAULT_CALLBACK;
  } catch {
    return DEFAULT_CALLBACK;
  }
  return raw;
}
