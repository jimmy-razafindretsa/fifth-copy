import { LandingHeader, LandingHero } from "@/features/landing";

export default function Home() {
  return (
    <>
      <LandingHeader />
      <main className="flex flex-1 flex-col">
        <LandingHero actions={null} />
      </main>
    </>
  );
}
