/**
 * The bare domain to its www host (#951): production's canonical origin is `NEXT_PUBLIC_APP_URL`
 * (`https://www.<domain>`); a request whose host is that host minus its leading `www.` is sent there.
 * Pure: no domain is written here, and nothing fires on localhost, a `*.up.railway.app` host, or a
 * canonical host without `www.`.
 */

/** The request's host as the client sent it: `x-forwarded-host` first (Railway's proxy), then `host`. */
export function requestHost(forwardedHost: string | null, host: string | null): string | null {
  const raw = (forwardedHost ?? host ?? "").split(",")[0]!.trim().toLowerCase();
  if (!raw) return null;
  // strip a port (`example.com:443`); an IPv6 literal `[::1]:3000` keeps its brackets
  const bracket = raw.startsWith("[") ? raw.indexOf("]") : -1;
  if (bracket > 0) return raw.slice(0, bracket + 1);
  const colon = raw.indexOf(":");
  return colon === -1 ? raw : raw.slice(0, colon);
}

/** The canonical URL to redirect to, or `null`: only when `host` is the canonical host's bare domain. */
export function apexRedirect(
  host: string | null,
  appUrl: string,
  pathAndQuery: string,
): string | null {
  if (!host) return null;
  let canonical: URL;
  try {
    canonical = new URL(appUrl);
  } catch {
    return null;
  }
  const www = canonical.hostname.toLowerCase();
  if (!www.startsWith("www.")) return null;
  if (host !== www.slice("www.".length)) return null;
  return new URL(pathAndQuery, canonical.origin).toString();
}
