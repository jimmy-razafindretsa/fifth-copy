"use client";

import { useState, type ReactNode } from "react";
import type { Member, MemberAvatar } from "@fifth-copy/protocol";
import { initialsOf } from "./seat-ring";
import styles from "./lobby.module.css";

/**
 * The route URL of a member's portrait (#730): the lobby-scoped avatar route (ADR 0014, 0022), the
 * 64 px file for the 32 px cell, the version from the wire (`Member.avatar`).
 */
export function portraitSrc(avatar: MemberAvatar): string {
  return `/api/avatars/${encodeURIComponent(avatar.userId)}?size=64&v=${avatar.v}`;
}

/** Where the picture is: none asked for, on its way, drawn, or refused (404) and gone. */
export type PortraitState = "initials" | "loading" | "loaded" | "failed";

/**
 * The roll's portrait cell (bible 14.4 portrait cell, 7.4 roll rows; #730): a 32px paper square in a
 * 2px ink rule holding the initials (first letters of the first two words, Plex Mono 500 12px). With a
 * picture the `<img>` lies over them, `alt=""` (the name is the row's text); they stay underneath until
 * it has loaded, and a failed load (404 for a non-member, a revoked or replaced avatar) removes it, so
 * the initials come back in the same square: no layout shift. Decoration for assistive tech.
 */
export function PortraitCellView({
  name,
  src,
  state,
  onLoad,
  onError,
}: {
  name: string;
  src: string | null;
  state: PortraitState;
  onLoad?: () => void;
  onError?: () => void;
}) {
  return (
    <span className={styles.portrait} data-portrait={state} aria-hidden="true">
      <span className={styles.initials}>{initialsOf(name)}</span>
      {src && state !== "failed" ? (
        // The route serves our own WebP behind an authorization check (ADR 0014): next/image would
        // proxy it through the optimizer and its shared cache, which the route forbids (`private`).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={32}
          height={32}
          className={styles.avatar}
          onLoad={onLoad}
          onError={onError}
        />
      ) : null}
    </span>
  );
}

/** The cell with its load state, keyed by the URL: a new avatar version gets a fresh try. */
export function PortraitCell({ name, avatar }: { name: string; avatar: MemberAvatar | null }) {
  const src = avatar ? portraitSrc(avatar) : null;
  const [settled, setSettled] = useState<{ src: string; state: "loaded" | "failed" } | null>(null);
  const state: PortraitState = !src ? "initials" : settled?.src === src ? settled.state : "loading";
  return (
    <PortraitCellView
      name={name}
      src={src}
      state={state}
      onLoad={() => src && setSettled({ src, state: "loaded" })}
      onError={() => src && setSettled({ src, state: "failed" })}
    />
  );
}

/** The roll's `leading` slot (`PlayerList`): a portrait for every human row; bots have none. */
export function portraitSlot(member: Member): ReactNode {
  return member.isBot ? null : <PortraitCell name={member.name} avatar={member.avatar} />;
}
