import { AuthScreen } from "@/features/identity";
import { SiteHeader } from "@/app/_components/site-header";
import "../merge-steps";

/** `/sign-up` (#36, ADR 0009): the site header and the sign-up screen. */
export default function SignUpPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <AuthScreen mode="sign-up" />
      </main>
    </>
  );
}
