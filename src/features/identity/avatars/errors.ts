// Typed upload rejections (ADR 0014). They carry a code only, never request data or file bytes;
// callers map the code to a bilingual message.
export const AVATAR_ERROR_CODES = [
  "TooLarge",
  "WrongType",
  "TooSmall",
  "Undecodable",
  "BadCrop",
] as const;
export type AvatarErrorCode = (typeof AVATAR_ERROR_CODES)[number];

export abstract class AvatarError extends Error {
  abstract readonly code: AvatarErrorCode;

  constructor() {
    super("Avatar rejected");
  }

  // On the prototype, not an own property (same style as UnauthenticatedError).
  override get name() {
    return `Avatar${this.code}Error`;
  }

  override get message() {
    return `Avatar rejected: ${this.code}`;
  }
}

/** Over 5 MB, or more pixels than the decoder accepts. */
export class TooLarge extends AvatarError {
  readonly code = "TooLarge";
}
/** Not JPEG, PNG, WebP or GIF by magic bytes, or the decoder disagrees with the magic bytes. */
export class WrongType extends AvatarError {
  readonly code = "WrongType";
}
/** Smaller than 64x64 px after orientation. */
export class TooSmall extends AvatarError {
  readonly code = "TooSmall";
}
/** Right magic bytes, but the decoder cannot read it (truncated, corrupt). */
export class Undecodable extends AvatarError {
  readonly code = "Undecodable";
}
/** The square crop is malformed or does not lie inside the image. */
export class BadCrop extends AvatarError {
  readonly code = "BadCrop";
}
