import type { PrismaClient } from "../src/generated/prisma/client";

/** Fixed dev guest (bible: guest names are `<Animal>-<3 digits>`). */
export const SEED_GUEST_TYPIST_NAME = "Sparrow-482";

/** Idempotent: upserts one guest keyed on the unique typistName. */
export async function seedIdentity(db: PrismaClient) {
  return db.user.upsert({
    where: { typistName: SEED_GUEST_TYPIST_NAME },
    update: {},
    create: { isGuest: true, typistName: SEED_GUEST_TYPIST_NAME },
  });
}
