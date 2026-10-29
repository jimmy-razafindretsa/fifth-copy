import "server-only";
import { isIP } from "node:net";
import { cookies, headers } from "next/headers";
import { env } from "@/env";
import { GUEST_COOKIE } from "../auth";
import { verifyGuestCookie } from "../auth/guest-cookie";

/**
 * Reverse proxies in front of the web app that append to `X-Forwarded-For` (ADR 0012: one Caddy,
 * ADR 0020). The client IP is the hop this many entries from the end: the one the outermost
 * trusted proxy wrote from its TCP peer. Entries before it are client-supplied.
 */
export const TRUSTED_PROXY_HOPS = 1;

/** The subject of a request whose address is missing or not an IP literal. */
export const UNKNOWN_IP_SUBJECT = "ip:unknown";

/** `value` as an IP literal (v4 or v6, lower case), else null. */
function ipLiteral(value: string | null | undefined): string | null {
  const ip = value?.trim().toLowerCase();
  return ip && isIP(ip) ? ip : null;
}

/**
 * Who a web rate limit counts (#207): the signed-in guest when the request carries a valid guest
 * cookie (`guest:<user id>`), else the client IP (`ip:<address>`), so a class behind one NAT that
 * already holds guest cookies is not one subject. The IP is the `TRUSTED_PROXY_HOPS`th
 * `X-Forwarded-For` entry from the end (else `X-Real-IP`), and only when it is an IP literal;
 * anything else is `ip:unknown`. Without a proxy (local dev) the header is client-controlled,
 * which is why production must run behind one.
 */
export async function requestSubject(): Promise<string> {
  const guest = verifyGuestCookie((await cookies()).get(GUEST_COOKIE)?.value, env.AUTH_SECRET);
  if (guest) return `guest:${guest}`;
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const hop = forwarded ? forwarded.split(",").at(-TRUSTED_PROXY_HOPS) : h.get("x-real-ip");
  const ip = ipLiteral(hop);
  return ip ? `ip:${ip}` : UNKNOWN_IP_SUBJECT;
}
