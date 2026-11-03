import { Prisma } from "@/generated/prisma/client";

/** Every model of prisma/schema/*.prisma, for code outside the Prisma-allowed folders (#56). */
export const MODEL_NAMES: readonly string[] = Object.values(Prisma.ModelName);
