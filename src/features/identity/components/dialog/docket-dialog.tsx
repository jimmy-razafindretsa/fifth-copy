"use client";

import { useEffect, useRef, type ReactNode } from "react";
import settings from "../settings/settings.module.css";
import styles from "./docket-dialog.module.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The docket dialog (#70, #60; bible 7.4 extension "Docket dialog"): a native modal `<dialog>` drawn as
 * one 7.4 docket (2px ink rule, paper ground, mono form name + ink tag header, the 7.1 print offset),
 * over a press-ink veil; a full-screen sheet on phones. Named by its title, focus kept inside (the
 * modal makes the page inert, Tab wraps), Escape is `onCancel`, and the focus goes back to where it was
 * when it opened. No motion (the settings family has none).
 */
export function DocketDialog({
  open,
  onCancel,
  titleId,
  describedBy,
  form,
  tag,
  busy = false,
  children,
  name,
}: {
  open: boolean;
  /** Escape, or the dialog closed by the browser: the caller's "ask me later" / "cancel". */
  onCancel: () => void;
  titleId: string;
  describedBy?: string;
  form: string;
  tag: string;
  busy?: boolean;
  children: ReactNode;
  /** `data-dialog` value, for tests and `/design`. */
  name: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    if (!open && returnTo.current) {
      const target = returnTo.current;
      returnTo.current = null;
      if (target.isConnected) target.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      data-dialog={name}
      onCancel={(event) => {
        event.preventDefault();
        cancel.current();
      }}
      onClose={() => {
        // closed by the browser itself (a second Escape skips `cancel`): keep the caller in step
        if (open) cancel.current();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (el) => el.getClientRects().length > 0 || el.matches("input"),
        );
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div className={settings.docketHeader}>
        <span className={settings.docketForm}>{form}</span>
        <span className={settings.tag}>{tag}</span>
      </div>
      {children}
    </dialog>
  );
}

export { styles as dialogStyles };
