import { avatarStore } from "../avatars/default-store";
import { AVATAR_SIZES, avatarKey, type AvatarFiles } from "../avatars/store";
import { registerMergeStep, type MergeStep } from "./registry";

// Identity steps of the guest merge (#56). Prisma models: prisma/schema/identity.prisma.

/** Thrown when the guest owns something a guest can never own (sign-in links, recovery code). */
export class MergeGuestError extends Error {
  override get name() {
    return "MergeGuestError";
  }
}

/** Preference: the account's non-null values win, else the guest's; a lone guest row moves. */
export const preferenceStep: MergeStep = {
  model: "Preference",
  async run(tx, guestId, accountId) {
    const guest = await tx.preference.findUnique({ where: { userId: guestId } });
    if (!guest) return 0;
    const account = await tx.preference.findUnique({ where: { userId: accountId } });
    if (!account) {
      await tx.preference.update({ where: { userId: guestId }, data: { userId: accountId } });
      return 1;
    }
    // theme and sound are never null: the account's value always wins there.
    await tx.preference.update({
      where: { userId: accountId },
      data: { layout: account.layout ?? guest.layout, locale: account.locale ?? guest.locale },
    });
    return 1;
  },
};

/**
 * A guest has no sign-in link, no recovery code and no password reset (one is issued only for an
 * account with a password, by a non-guest host, #788): one present means the ids are wrong.
 */
function guestHasNone(model: "OAuthAccount" | "RecoveryCode" | "PasswordReset"): MergeStep {
  return {
    model,
    async run(tx, guestId) {
      const owned =
        model === "OAuthAccount"
          ? await tx.oAuthAccount.count({ where: { userId: guestId } })
          : model === "RecoveryCode"
            ? await tx.recoveryCode.count({ where: { userId: guestId } })
            : await tx.passwordReset.count({
                where: { OR: [{ userId: guestId }, { issuedByUserId: guestId }] },
              });
      if (owned > 0) throw new MergeGuestError(`Guest owns ${model} rows`);
      return 0;
    },
  };
}

const VERSION = /^(\d{1,15})$/;

/**
 * Avatar (User.avatarKey, ADR 0014): the account keeps its own; otherwise it takes the guest's
 * version, whose files are copied under the account before commit (removed again on rollback).
 * The guest's files are deleted after commit in every case.
 */
export const avatarStep: MergeStep = {
  model: "User",
  async run(tx, guestId, accountId, ctx) {
    ctx.afterCommit(() => avatarStore.delete(guestId));
    const [guest, account] = await Promise.all([
      tx.user.findUniqueOrThrow({
        where: { id: guestId },
        select: { avatarKey: true, avatarStatus: true },
      }),
      tx.user.findUniqueOrThrow({ where: { id: accountId }, select: { avatarKey: true } }),
    ]);
    if (account.avatarKey !== null || guest.avatarKey === null) return 0;
    const [owner, raw] = guest.avatarKey.split("/");
    const version = Number(VERSION.exec(raw ?? "")?.[1]);
    if (owner !== guestId || !Number.isSafeInteger(version) || version <= 0) return 0;

    const files: Partial<AvatarFiles> = {};
    for (const size of AVATAR_SIZES) {
      const bytes = await avatarStore.get(guestId, version, size);
      if (!bytes) return 0; // incomplete files: nothing worth moving
      files[size] = bytes;
    }
    ctx.onRollback(() => avatarStore.delete(accountId, { version }));
    await avatarStore.put(accountId, version, files as AvatarFiles);
    await tx.user.update({
      where: { id: accountId },
      data: { avatarKey: avatarKey(accountId, version), avatarStatus: guest.avatarStatus },
    });
    return 1;
  },
};

export const IDENTITY_STEPS: readonly MergeStep[] = [
  preferenceStep,
  guestHasNone("OAuthAccount"),
  guestHasNone("RecoveryCode"),
  guestHasNone("PasswordReset"),
  avatarStep,
];

for (const step of IDENTITY_STEPS) registerMergeStep(step);
