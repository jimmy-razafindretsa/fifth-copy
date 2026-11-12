import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { hashPassword } from "@/server/auth";
import { canonicalRecoveryCode, generateRecoveryCode } from "../recovery/generate";

/**
 * Issues (or rotates) the account's one recovery code (#46 C1, C3, ADR 0009) inside the caller's
 * transaction: 10 fresh words, only the Argon2id hash of their canonical form stored in `RecoveryCode`
 * (`rotatedAt` set when a code existed). Returns the words in draw order: the only plaintext copy,
 * for the caller to reveal once. Never logs them.
 */
export async function issueRecoveryCode(
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  const words = generateRecoveryCode();
  const codeHash = await hashPassword(canonicalRecoveryCode(words)!);
  await tx.recoveryCode.upsert({
    where: { userId },
    create: { userId, codeHash },
    update: { codeHash, rotatedAt: new Date() },
  });
  return words;
}
