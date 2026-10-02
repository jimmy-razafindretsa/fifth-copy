import "server-only";
import { env } from "@/env";
import { createPrismaClient } from "./db-client";

// Reuse one client across hot reloads in development.
const globalForDb = globalThis as unknown as { db?: ReturnType<typeof createPrismaClient> };

export const db = globalForDb.db ?? createPrismaClient(env.DATABASE_URL);

if (env.NODE_ENV !== "production") globalForDb.db = db;
