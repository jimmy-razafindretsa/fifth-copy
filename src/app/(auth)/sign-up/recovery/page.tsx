import { redirect } from "next/navigation";
import { getViewer, RecoveryRevealScreen, takeRecoveryReveal } from "@/features/identity";
import { LandingHeader } from "@/features/landing";

/**
 * `/sign-up/recovery` (#46 C2, ADR 0009): right after a username sign-up, the one-time recovery code.
 * Signed-in accounts only; the one-shot reveal is consumed by this render, so a reload shows the
 * `ALREADY SHOWN` row instead.
 */
export default async function RecoveryRevealPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.isGuest) redirect("/sign-up");
  const words = await takeRecoveryReveal(viewer.id);
  return (
    <>
      <LandingHeader />
      <main className="flex flex-1 flex-col">
        <RecoveryRevealScreen words={words} />
      </main>
    </>
  );
}
