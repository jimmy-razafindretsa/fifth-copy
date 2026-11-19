import type { Metadata } from "next";
import { SiteHeader } from "@/app/_components/site-header";
import { getGuideDesk, GuideScreen } from "@/features/guide";
import { getT } from "@/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t.guide.title} · ${t.brand.name}` };
}

/**
 * `/guide` (#999 C26): "How to type it", for everyone (no guest created). `?layout=` and `?os=` override
 * the viewer's saved layout and the detected OS.
 */
export default async function GuidePage({ searchParams }: PageProps<"/guide">) {
  const { layout, os } = await searchParams;
  const desk = await getGuideDesk({ layout, os });
  return <GuideScreen header={<SiteHeader />} desk={desk} />;
}
