import { LandingHeader } from "@/features/landing";
import { NotFoundScreen } from "@/features/system";

/** Root not-found: the in-world form 404 with the Major (card 397). Next sends it with a 404 status. */
export default function NotFound() {
  return (
    <>
      <LandingHeader />
      <main className="flex flex-1 flex-col">
        <NotFoundScreen />
      </main>
    </>
  );
}
