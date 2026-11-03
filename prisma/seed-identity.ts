import type { PrismaClient } from "../src/generated/prisma/client";
import { normalizeUsername } from "../src/features/identity/schema";

/** Fixed dev guest (bible: guest names are `<Animal>-<3 digits>`). */
export const SEED_GUEST_TYPIST_NAME = "Sparrow-482";

/** Fixed dev account (#486): signs in through its GitHub link; no password (Argon2id arrives with #38). */
export const SEED_ACCOUNT_USERNAME = "Heron";
/** Fake GitHub account id for the dev account; not a real GitHub user. */
export const SEED_ACCOUNT_PROVIDER_ACCOUNT_ID = "seed-github-0001";

/**
 * Idempotent: upserts one guest keyed on the unique typistName, and one account user keyed on its
 * normalized username with one GITHUB link and one Preference row. Returns the guest.
 */
export async function seedIdentity(db: PrismaClient) {
  const guest = await db.user.upsert({
    where: { typistName: SEED_GUEST_TYPIST_NAME },
    update: {},
    create: { isGuest: true, typistName: SEED_GUEST_TYPIST_NAME },
  });

  const account = await db.user.upsert({
    where: { usernameNormalized: normalizeUsername(SEED_ACCOUNT_USERNAME) },
    update: {},
    create: {
      isGuest: false,
      typistName: SEED_ACCOUNT_USERNAME,
      username: SEED_ACCOUNT_USERNAME,
      usernameNormalized: normalizeUsername(SEED_ACCOUNT_USERNAME),
    },
  });
  await db.oAuthAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: "GITHUB",
        providerAccountId: SEED_ACCOUNT_PROVIDER_ACCOUNT_ID,
      },
    },
    update: {},
    create: {
      userId: account.id,
      provider: "GITHUB",
      providerAccountId: SEED_ACCOUNT_PROVIDER_ACCOUNT_ID,
    },
  });
  await db.preference.upsert({
    where: { userId: account.id },
    update: {},
    create: { userId: account.id },
  });

  return guest;
}
