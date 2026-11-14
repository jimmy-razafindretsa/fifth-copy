import { getViewer } from "@/features/identity";
import { HomeView } from "./_components/home-view";
import { LandingView } from "./_components/landing-view";

/**
 * `/` (#943 C1, ADR 0009): a viewer (an account, or a guest whose cookie resolves) gets the Home menu;
 * a first-time visitor, and a stale cookie that resolves to nobody, the landing. Reading creates nothing.
 */
export default async function Home() {
  const viewer = await getViewer();
  return viewer ? <HomeView viewer={viewer} /> : <LandingView />;
}
