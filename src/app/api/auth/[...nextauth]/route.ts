import "@/features/identity";
import { oauthSignInHooks, withCredentialsThrottle } from "@/features/identity/server";
import { handlers, registerOAuthSignInHooks } from "@/server/auth";
// The guest merge runs every registered step or refuses (#56): this route graph needs them too (#49),
// identity's own steps with `@/features/identity`.
import "../../../(auth)/merge-steps";

// Auth.js endpoints (#786, ADR 0009): session, csrf, providers, signin/signout and callbacks. OAuth
// callbacks screen the provider login and merge the current guest through identity's hooks (#49).
registerOAuthSignInHooks(oauthSignInHooks);

export const { GET } = handlers;
// The credentials callback spends the sign-in budgets of the sign-in action (#87 C5).
export const POST = withCredentialsThrottle(handlers.POST);
