import type { Metadata } from "next";
import { LandingHeader } from "@/features/landing";
import { PrivacyScreen } from "@/features/privacy";
import { getT } from "@/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t.privacy.title} · ${t.brand.name}` };
}

/** `/privacy` (card #76): the privacy page in the viewer's language (ADR 0010), French first in the files. */
export default function PrivacyPage() {
  return <PrivacyScreen header={<LandingHeader />} />;
}
