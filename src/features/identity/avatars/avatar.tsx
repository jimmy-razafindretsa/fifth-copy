import { DefaultPortrait } from "./default-portrait";

/** Who an avatar shows: the viewer shape (ADR 0009) plus the stored version (`avatarKey`, ADR 0014). */
export type AvatarUser = {
  id: string;
  name: string;
  /** An APPROVED picture is on file (a PENDING one shows the portrait, ADR 0015). */
  hasAvatar: boolean;
  avatarVersion: number | null;
};

export type AvatarDisplaySize = 32 | 64 | 128;

/** The stored file that covers a display size: 64 px up to 64, 256 px above. */
const fileSize = (size: AvatarDisplaySize) => (size > 64 ? 256 : 64);

/** The route URL of a stored picture (#62, ADR 0014); the version busts every cache on change. */
export function avatarSrc(user: AvatarUser, size: AvatarDisplaySize): string {
  return `/api/avatars/${encodeURIComponent(user.id)}?size=${fileSize(size)}&v=${user.avatarVersion}`;
}

/**
 * One avatar everywhere (#60 C2): the stored picture through the avatar route, or the stamped
 * portrait. Named by the typist name; `decorative` when the name is already written beside it.
 */
export function Avatar({
  user,
  size,
  decorative = false,
  className,
}: {
  user: AvatarUser;
  size: AvatarDisplaySize;
  decorative?: boolean;
  className?: string;
}) {
  if (user.hasAvatar && user.avatarVersion !== null) {
    return (
      // The route serves our own WebP at a fixed size behind an authorization check (ADR 0014):
      // next/image would proxy it through the optimizer and its cache, which the route forbids.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarSrc(user, size)}
        alt={decorative ? "" : user.name}
        width={size}
        height={size}
        className={className}
        data-avatar="stored"
      />
    );
  }
  return (
    <DefaultPortrait
      seed={user.id}
      size={size}
      label={decorative ? undefined : user.name}
      className={className}
    />
  );
}
