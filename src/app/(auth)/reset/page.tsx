import { ResetScreen } from "@/features/identity";
import { SiteHeader } from "@/app/_components/site-header";

/**
 * `/reset` (#789, ADR 0009): the site header and the reset screen, where a student redeems the code
 * a teacher issued (#788, #790). Reads no query parameter: the code never travels in the URL.
 */
export default function ResetPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <ResetScreen />
      </main>
    </>
  );
}
