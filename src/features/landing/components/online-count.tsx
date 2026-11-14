import { Suspense } from "react";
import { fill } from "@/i18n/format";
import type { Messages } from "@/i18n/en";

export type OnlineLabels = Pick<Messages["home"], "online" | "onlineSpoken">;
/** The lobby feature's `countTypistsOnline` answer (passed by the route, ADR 0021). */
export type OnlineResult = { ok: true; online: number } | { ok: false };

/**
 * Players online in the key-hint bar (#943 C22): ` · <n> ONLINE` after the version, read as `<n> players
 * online`. Streams in its own `Suspense` boundary; an unknown figure (or a failed read) renders nothing,
 * so the bar shows the version alone. Only the number reaches the HTML.
 */
export function OnlineCount(props: { load: () => Promise<OnlineResult>; labels: OnlineLabels }) {
  return (
    <Suspense fallback={null}>
      <OnlineCountLoaded {...props} />
    </Suspense>
  );
}

export async function OnlineCountLoaded({
  load,
  labels,
}: {
  load: () => Promise<OnlineResult>;
  labels: OnlineLabels;
}) {
  const result = await load().catch(() => ({ ok: false }) as const);
  return result.ok ? <OnlineFigure online={result.online} labels={labels} /> : null;
}

export function OnlineFigure({ online, labels }: { online: number; labels: OnlineLabels }) {
  const spoken = fill(online === 1 ? labels.onlineSpoken.one : labels.onlineSpoken.other, {
    n: online,
  });
  return (
    <>
      <span aria-hidden="true"> · </span>
      <span data-online={online}>
        <span aria-hidden="true">{fill(labels.online, { n: online })}</span>
        <span className="sr-only">{spoken}</span>
      </span>
    </>
  );
}
