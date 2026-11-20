import type { ReactNode } from "react";
import { getT } from "@/i18n";
import { GUIDE_CONTENT } from "../content";
import { GuideView, type GuideDesk } from "./guide-view";

/** `/guide` as served: the viewer's language (ADR 0010) and the real content, on the desk the route read. */
export async function GuideScreen({ header, desk }: { header: ReactNode; desk: GuideDesk }) {
  const t = await getT();
  return (
    <GuideView
      header={header}
      labels={t.guide}
      layoutNames={t.settings.layout.names}
      content={GUIDE_CONTENT}
      desk={desk}
    />
  );
}
