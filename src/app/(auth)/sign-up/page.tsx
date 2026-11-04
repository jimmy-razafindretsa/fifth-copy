import { AuthScreen } from "@/features/identity";
import { LandingHeader } from "@/features/landing";

/** `/sign-up` (#36, ADR 0009): the site header and the sign-up screen. */
export default function SignUpPage() {
  return (
    <>
      <LandingHeader />
      <main className="flex flex-1 flex-col">
        <AuthScreen mode="sign-up" />
      </main>
    </>
  );
}
