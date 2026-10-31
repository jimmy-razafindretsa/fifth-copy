import type { Metadata } from "next";
import { getT } from "@/i18n";
import { KeyRecorder } from "./key-recorder";
import s from "./key-recorder.module.css";

/** Dev-facing (#566 C4): never indexed and never in a sitemap; reachable in production so the fixtures can
 * be recorded on real Windows, macOS and ChromeOS machines (C3). */
export const metadata: Metadata = {
  title: "Dead-key recorder",
  robots: { index: false, follow: false },
};

/** The dead-key recorder (#566): records the browser's event sequences for accented input as fixtures. */
export default async function DesignKeysPage() {
  const t = await getT();
  const l = t.design.keys;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 md:px-8">
      <header className="flex flex-col gap-3">
        <p>
          <span data-dev-only className={s.tag}>
            {l.devOnly}
          </span>
        </p>
        <h1 className="type-display-lg text-fg">{l.title}</h1>
        <p className="type-body max-w-prose text-fg">{l.intro}</p>
      </header>
      <KeyRecorder labels={l} />
    </main>
  );
}
