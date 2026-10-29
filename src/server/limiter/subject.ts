import "server-only";
import { cookies, headers } from "next/headers";
import { env } from "@/env";
import { GUEST_COOKIE } from "../auth";
import { verifyGuestCookie } from "../auth/guest-cookie";

/**
 * Who a web rate limit counts (#207): the signed-in guest when the request carries a valid guest
 * cookie (`guest:<user id>`), else the client IP (`ip:<address>`), so a class behind one NAT that
 * already holds guest cookies is not one subject. The IP is the last `X-Forwarded-For` hop: the one
 * the single reverse proxy in front of the app (ADR 0012) wrote from the TCP peer; hops before it
 * are client-supplied. Without a proxy (local dev) the header is client-controlled, which is why
 * production must run behind one; with no header the subject is `ip:unknown`.
 */
export async function requestSubject(): Promise<string> {
  const guest = verifyGuestCookie((await cookies()).get(GUEST_COOKIE)?.value, env.AUTH_SECRET);
  if (guest) return `guest:${guest}`;
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  const ip = forwarded || h.get("x-real-ip")?.trim() || "unknown";
  return `ip:${ip.slice(0, 64)}`;
}
