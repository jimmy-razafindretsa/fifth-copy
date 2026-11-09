/** The version part of `avatarKey` (`<userId>/<version>`, ADR 0014), or null. Pure: no env, no db. */
export function versionOf(key: string | null | undefined): number | null {
  const version = Number(key?.slice(key.lastIndexOf("/") + 1));
  return key && Number.isSafeInteger(version) && version > 0 ? version : null;
}
