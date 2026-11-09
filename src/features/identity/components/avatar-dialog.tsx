"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Button } from "@/components/ui";
import type { UploadAvatarResult } from "../actions/upload-avatar";
import { Avatar, type AvatarUser } from "../avatars/avatar";
import {
  centredCrop,
  MAX_ZOOM,
  nudgeStep,
  panBy,
  withZoom,
  zoomOf,
  type CropRect,
  type Picture,
} from "../avatars/crop";
import type { AvatarErrorCode } from "../avatars/errors";
import { DocketDialog, dialogStyles } from "./dialog/docket-dialog";
import settings from "./settings/settings.module.css";
import styles from "./avatar-dialog.module.css";

/** The upload cap (ADR 0014, `MAX_AVATAR_BYTES`), checked here first so a big file never travels. */
const MAX_BYTES = 5 * 1024 * 1024;
const MIN_PX = 64;
/** The frame is the 256 px preview: what is inside it is the stored 256 px picture. */
const FRAME = 256;

type ErrorKey = AvatarErrorCode | "failed";
type Phase =
  | { name: "idle" }
  | { name: "chosen" }
  | { name: "pending" }
  // `message`: the server's own localized line (the #87 upload throttle, with its retry delay)
  | { name: "error"; code: ErrorKey; message?: string }
  | { name: "review" };

export type AvatarDialogLabels = {
  trigger: string;
  form: string;
  tag: string;
  title: string;
  body: string;
  rules: string;
  choose: string;
  chooseAnother: string;
  crop: string;
  zoom: string;
  current: string;
  preview: string;
  save: string;
  saving: string;
  cancel: string;
  close: string;
  saved: string;
  reviewTitle: string;
  errorPrefix: string;
  errors: Record<ErrorKey, string>;
  moderation: { pending: string; rejected: string; appeal: string };
};

type Chosen = { file: File; url: string; pic: Picture };

/**
 * The picture dialog (#60, ADR 0014, 0015; bible 7.4 "Docket dialog"): CHANGE PICTURE opens a docket
 * with the picture on file, a file input (`image/*`), then a square frame over the chosen picture
 * (drag to move, wheel or the ZOOM slider to zoom, arrow keys to nudge) with live 256 and 64 px
 * previews, and SIGN & FILE / CANCEL. Save sends the file and the crop rect to `uploadAvatar`.
 * States: idle, chosen, pending (`aria-busy`), error (the 7.4 inline error line), review pending (a
 * flagged picture: the portrait stays, an info row, not an error) and success (closes; the header's
 * avatar shows the new version after the refresh).
 */
export function AvatarDialog({
  action,
  user,
  labels,
  initialOpen = false,
}: {
  action: (form: FormData) => Promise<UploadAvatarResult>;
  user: AvatarUser;
  labels: AvatarDialogLabels;
  initialOpen?: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [filed, setFiled] = useState(false);
  const [, startTransition] = useTransition();
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const pending = phase.name === "pending";
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  const errorId = `${id}-error`;
  const fileId = `${id}-file`;

  // free the object URL of a picture once it is replaced or the dialog unmounts
  useEffect(() => () => void (chosen && URL.revokeObjectURL(chosen.url)), [chosen]);

  // the wheel zooms the frame, not the page (React's wheel listener is passive)
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !chosen) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setCrop((rect) =>
        rect
          ? withZoom(
              rect,
              zoomOf(rect, chosen.pic) * (event.deltaY < 0 ? 1.1 : 1 / 1.1),
              chosen.pic,
            )
          : rect,
      );
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [chosen]);

  const reset = () => {
    setChosen(null);
    setCrop(null);
    setPhase({ name: "idle" });
  };
  const close = () => {
    if (pending) return;
    setOpen(false);
    reset();
  };

  const choose = (file: File | undefined) => {
    if (!file) return;
    setFiled(false);
    if (file.size > MAX_BYTES) {
      setChosen(null);
      setPhase({ name: "error", code: "TooLarge" });
      return;
    }
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      const pic = { width: probe.naturalWidth, height: probe.naturalHeight };
      if (pic.width < MIN_PX || pic.height < MIN_PX) {
        URL.revokeObjectURL(url);
        setChosen(null);
        setPhase({ name: "error", code: "TooSmall" });
        return;
      }
      setChosen({ file, url, pic });
      setCrop(centredCrop(pic));
      setPhase({ name: "chosen" });
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      setChosen(null);
      setPhase({ name: "error", code: "WrongType" });
    };
    probe.src = url;
  };

  const save = () => {
    if (!chosen || !crop || pending) return;
    const form = new FormData();
    form.set("file", chosen.file);
    form.set("crop", JSON.stringify(crop));
    setPhase({ name: "pending" });
    startTransition(async () => {
      let result: UploadAvatarResult;
      try {
        result = await action(form);
      } catch {
        setPhase({ name: "error", code: "failed" });
        return;
      }
      if (!result.ok) {
        setPhase(
          result.code === "RateLimited"
            ? { name: "error", code: "failed", message: result.message }
            : { name: "error", code: result.code },
        );
        return;
      }
      router.refresh();
      if (result.status === "PENDING") {
        setChosen(null);
        setPhase({ name: "review" });
        return;
      }
      setFiled(true);
      setOpen(false);
      reset();
    });
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!chosen || !crop || pending) return;
    const step = nudgeStep(crop) * (FRAME / crop.size);
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      // an arrow moves the frame over the picture (the picture slides the other way)
      setCrop(panBy(crop, move[0], move[1], FRAME, chosen.pic));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setCrop(withZoom(crop, zoomOf(crop, chosen.pic) * 1.1, chosen.pic));
    } else if (event.key === "-") {
      event.preventDefault();
      setCrop(withZoom(crop, zoomOf(crop, chosen.pic) / 1.1, chosen.pic));
    }
  };

  const view = (size: number) => {
    if (!chosen || !crop) return undefined;
    const scale = size / crop.size;
    return {
      width: chosen.pic.width * scale,
      height: chosen.pic.height * scale,
      transform: `translate(${-crop.x * scale}px, ${-crop.y * scale}px)`,
    };
  };

  const errorLines =
    phase.name !== "error"
      ? []
      : phase.code === "Rejected"
        ? [labels.moderation.rejected, labels.moderation.appeal]
        : [phase.message ?? labels.errors[phase.code]];

  return (
    <>
      <Button
        variant="secondary"
        size="lg"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        data-avatar-trigger=""
      >
        {labels.trigger}
      </Button>
      <p role="status" className={settings.status} data-status={filed ? "saved" : "idle"}>
        {filed ? labels.saved : ""}
      </p>
      <DocketDialog
        open={open}
        onCancel={close}
        titleId={titleId}
        describedBy={bodyId}
        form={labels.form}
        tag={labels.tag}
        busy={pending}
        name="avatar"
      >
        <div className={dialogStyles.body} data-phase={phase.name}>
          <h2 id={titleId} className={dialogStyles.title}>
            {labels.title}
          </h2>
          <p id={bodyId} className={settings.hint}>
            {labels.body}
          </p>

          <div className={styles.work}>
            {chosen && crop ? (
              <>
                <figure className={styles.figure}>
                  <div
                    ref={frameRef}
                    className={styles.frame}
                    role="group"
                    aria-label={labels.crop}
                    tabIndex={0}
                    data-preview="256"
                    data-crop={JSON.stringify(crop)}
                    onKeyDown={onKey}
                    onPointerDown={(event) => {
                      if (pending) return;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      drag.current = { x: event.clientX, y: event.clientY };
                    }}
                    onPointerMove={(event) => {
                      const from = drag.current;
                      if (!from) return;
                      drag.current = { x: event.clientX, y: event.clientY };
                      setCrop((rect) =>
                        rect
                          ? panBy(
                              rect,
                              event.clientX - from.x,
                              event.clientY - from.y,
                              FRAME,
                              chosen.pic,
                            )
                          : rect,
                      );
                    }}
                    onPointerUp={() => (drag.current = null)}
                    onPointerCancel={() => (drag.current = null)}
                  >
                    {/* a blob: URL of the user's own file, shown before any upload */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={chosen.url}
                      alt=""
                      draggable={false}
                      className={styles.picture}
                      style={view(FRAME)}
                    />
                  </div>
                  <figcaption className={settings.status}>{labels.preview} · 256 PX</figcaption>
                </figure>
                <div className={styles.side}>
                  <figure className={styles.figure}>
                    <div className={styles.small} data-preview="64" aria-hidden="true">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={chosen.url}
                        alt=""
                        draggable={false}
                        className={styles.picture}
                        style={view(64)}
                      />
                    </div>
                    <figcaption className={settings.status}>64 PX</figcaption>
                  </figure>
                  <label className={styles.zoom}>
                    <span className={settings.sectionTitle}>{labels.zoom}</span>
                    <input
                      type="range"
                      min={1}
                      max={MAX_ZOOM}
                      step={0.05}
                      value={zoomOf(crop, chosen.pic)}
                      disabled={pending}
                      onChange={(event) =>
                        setCrop(withZoom(crop, Number(event.target.value), chosen.pic))
                      }
                    />
                  </label>
                </div>
              </>
            ) : (
              <figure className={styles.figure}>
                <Avatar user={user} size={128} />
                <figcaption className={settings.status}>{labels.current}</figcaption>
              </figure>
            )}
          </div>

          <div className={styles.pick}>
            <input
              id={fileId}
              type="file"
              accept="image/*"
              className={styles.file}
              disabled={pending}
              onChange={(event) => {
                choose(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <label htmlFor={fileId} className={styles.choose}>
              {chosen ? labels.chooseAnother : labels.choose}
            </label>
            <p className={settings.hint}>{labels.rules}</p>
          </div>

          {phase.name === "review" && (
            <div role="status" className={styles.review}>
              <p className={styles.reviewTitle}>{labels.reviewTitle}</p>
              <p className={styles.reviewText}>{labels.moderation.pending}</p>
            </div>
          )}
          {errorLines.length > 0 && (
            <div id={errorId} role="alert" className={settings.errorLine}>
              <span className={settings.errorPrefix}>{labels.errorPrefix}</span>{" "}
              {errorLines.join(" ")}
            </div>
          )}
        </div>
        <div className={dialogStyles.actions}>
          <Button variant="secondary" size="lg" onClick={close} disabled={pending}>
            {phase.name === "review" ? labels.close : labels.cancel}
          </Button>
          {phase.name !== "review" && (
            <Button
              variant="primary"
              size="lg"
              onClick={save}
              disabled={!chosen || pending}
              aria-busy={pending || undefined}
              aria-describedby={phase.name === "error" ? errorId : undefined}
            >
              {pending ? labels.saving : labels.save}
            </Button>
          )}
        </div>
      </DocketDialog>
    </>
  );
}
