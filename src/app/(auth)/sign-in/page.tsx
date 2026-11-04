import { AuthScreen, safeCallbackUrl } from "@/features/identity";
import { LandingHeader } from "@/features/landing";
import "../merge-steps";

/**
 * `/sign-in` (#36, ADR 0009): the site header and the sign-in screen. `callbackUrl` (set by proxy.ts) is
 * passed on only when it is a same-origin path; any `error` (a provider sent the visitor back) shows the
 * OAuth callback error banner, whose words never echo the parameter.
 */
export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { callbackUrl, error } = await searchParams;
  const target = safeCallbackUrl(typeof callbackUrl === "string" ? callbackUrl : null);
  return (
    <>
      <LandingHeader />
      <main className="flex flex-1 flex-col">
        <AuthScreen
          mode="sign-in"
          callbackUrl={target === "/" ? null : target}
          oauthError={error !== undefined}
        />
      </main>
    </>
  );
}
