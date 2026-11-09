"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/env";
import { enabledOAuthProviders, signIn } from "@/server/auth";
import { safeCallbackUrl } from "../auth/callback-url";
import { OAUTH_PROVIDERS } from "../schema";

const provider = z.enum(OAUTH_PROVIDERS);

/**
 * CONTINUE WITH GITHUB / DISCORD / GOOGLE (#36 C8, #49). A configured provider (GitHub, Discord: ADR
 * 0009, `src/server/auth/providers.ts`) starts Auth.js's OAuth flow: `signIn` sets the state and PKCE
 * cookies and redirects to the provider, which comes back to `/api/auth/callback/<provider>`, then to
 * the same-origin `callbackUrl` (else `/`). Any other press returns to `/sign-in` with the OAuth error
 * banner (`OAuthSignin`, or `Configuration` for an unknown provider). Reads only the provider and the
 * callbackUrl.
 */
export async function continueWithProvider(form: FormData): Promise<never> {
  const parsed = provider.safeParse(form.get("provider"));
  const callbackUrl = form.get("callbackUrl");
  const target = safeCallbackUrl(typeof callbackUrl === "string" ? callbackUrl : null);
  const enabled: readonly string[] = enabledOAuthProviders(env);
  if (parsed.success && enabled.includes(parsed.data)) {
    // Throws Next's redirect to the provider's authorize URL.
    return (await signIn(parsed.data, { redirectTo: target })) as never;
  }
  const back = new URLSearchParams({ error: parsed.success ? "OAuthSignin" : "Configuration" });
  if (target !== "/") back.set("callbackUrl", target);
  redirect(`/sign-in?${back}`);
}
