import { RecoverScreen } from "@/features/identity";
import { SiteHeader } from "@/app/_components/site-header";

/**
 * `/recover` (#46, ADR 0009): the site header and the recover screen, where a user who lost their
 * password redeems their one-time recovery code. Reads no query parameter: the code never travels in
 * the URL.
 */
export default function RecoverPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <RecoverScreen />
      </main>
    </>
  );
}
