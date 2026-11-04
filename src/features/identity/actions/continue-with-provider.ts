"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeCallbackUrl } from "../auth/callback-url";
import { OAUTH_PROVIDERS } from "../schema";

const provider = z.enum(OAUTH_PROVIDERS);

/**
 * CONTINUE WITH GITHUB / DISCORD / GOOGLE (#36 C8). The OAuth providers and their flow are #49's:
 * until they are configured in `src/server/auth` the press returns to `/sign-in` with the OAuth
 * callback error banner, the same screen a failed provider callback shows. #49 replaces the body with Auth.js
 * `signIn(provider, { redirectTo })`. Reads only the provider and the callbackUrl.
 */
export async function continueWithProvider(form: FormData): Promise<never> {
  const parsed = provider.safeParse(form.get("provider"));
  const back = new URLSearchParams({ error: parsed.success ? "OAuthSignin" : "Configuration" });
  const callbackUrl = form.get("callbackUrl");
  const target = safeCallbackUrl(typeof callbackUrl === "string" ? callbackUrl : null);
  if (target !== "/") back.set("callbackUrl", target);
  redirect(`/sign-in?${back}`);
}
