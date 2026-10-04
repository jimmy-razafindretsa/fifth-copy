import "dotenv/config";
import { defineConfig } from "prisma/config";

// The datasource is declared only when DATABASE_URL is set: validate and generate need no DB,
// while migrate/db commands fail fast on the missing datasource.url. Never invent a fallback URL.
const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  ...(url ? { datasource: { url } } : {}),
});
