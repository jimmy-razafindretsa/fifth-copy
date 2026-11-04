// Server-only texts API (ADR 0021): what server code of other features may import from `texts`
// beside `index.ts`, which stays client-safe (no server guard, no Prisma).
import "server-only";
export { clearCorpusCache, loadCorpusProvider } from "./queries/corpus-provider";
