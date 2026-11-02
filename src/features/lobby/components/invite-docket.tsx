"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LobbyLabels } from "./lobby-labels";
import styles from "./lobby.module.css";

type InviteLabels = LobbyLabels["invite"];
export type CopyStatus = "idle" | "copied" | "selected";

/** The UI's slow duration (bible 8), read from the tokens: COPIED holds for three of it. */
const HOLD_TOKEN = "--motion-duration-slow";
const HOLD_FACTOR = 3;

/**
 * How long COPIED holds, in ms, from the computed `--motion-duration-slow` token: 600ms x 3. Under
 * reduced motion the token is `0ms`, so the hold is 0 and COPIED stays until the button blurs (a
 * confirmation, not motion: it must stay readable).
 */
export function copiedHoldMs(token: string): number {
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(token.trim());
  return match ? Number(match[1]) * (match[2] === "s" ? 1000 : 1) * HOLD_FACTOR : 0;
}

export type CopyDeps = {
  clipboard: Pick<Clipboard, "writeText"> | null | undefined;
  /** Selects the code's text, so the viewer can copy it by hand. */
  select: () => void;
};

/** Writes the code to the clipboard; without one, or on a refusal, selects the code text instead. */
export async function copyRoomCode(code: string, { clipboard, select }: CopyDeps) {
  try {
    if (clipboard) {
      await clipboard.writeText(code);
      return "copied" as const;
    }
  } catch {
    // no permission or an insecure context: fall back to the selection
  }
  select();
  return "selected" as const;
}

function selectText(id: string) {
  const node = document.getElementById(id);
  const selection = window.getSelection();
  if (node && selection) selection.selectAllChildren(node);
}

/** The invite row (no hooks, so every state renders in tests): `INVITE | COPY`, a polite status. */
export function InviteRow({
  status,
  labels,
  onCopy,
  onBlur,
}: {
  status: CopyStatus;
  labels: InviteLabels;
  onCopy: () => void;
  onBlur: () => void;
}) {
  return (
    <div className={`${styles.row} ${styles.invite}`}>
      <dt className={styles.label}>{labels.label}</dt>
      <dd className={styles.value}>
        <button type="button" className={styles.ink} onClick={onCopy} onBlur={onBlur}>
          {status === "copied" ? labels.copied : labels.copy}
        </button>
        <span aria-live="polite" className={styles.srOnly}>
          {status === "copied"
            ? labels.copiedStatus
            : status === "selected"
              ? labels.selectedStatus
              : ""}
        </span>
      </dd>
    </div>
  );
}

/**
 * The invite rows of the room docket (#498, bible 7.1 ink button, 7.4 rows): COPY writes the room code
 * to the clipboard and reads COPIED for `--motion-duration-slow` x 3 (until blur under reduced motion);
 * without a clipboard it selects the docket's code (`codeId`). `links`: the single-use link row (#121).
 */
export function InviteDocket({
  code,
  codeId,
  labels,
  links,
}: {
  code: string;
  codeId: string;
  labels: InviteLabels;
  links?: ReactNode;
}) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function onCopy() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const result = await copyRoomCode(code, {
      clipboard: navigator.clipboard,
      select: () => selectText(codeId),
    });
    setStatus(result);
    if (result !== "copied") return;
    // the tokens live on :root, which also carries `data-motion="reduce"` (tokens.css)
    const token = getComputedStyle(document.documentElement).getPropertyValue(HOLD_TOKEN);
    const hold = copiedHoldMs(token);
    if (hold === 0) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setStatus("idle");
    }, hold);
  }

  // under reduced motion COPIED has no timer: it goes when focus leaves the button
  function onBlur() {
    if (!timer.current) setStatus((s) => (s === "copied" ? "idle" : s));
  }

  return (
    <>
      <InviteRow status={status} labels={labels} onCopy={onCopy} onBlur={onBlur} />
      {links}
    </>
  );
}
