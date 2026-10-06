// Public texts API (ARCHITECTURE 8.2). Side-effect free and safe in client
// components: no server-only, no Prisma. Server-side texts exports belong in
// server-only modules, not here.
export { isClean } from "./profanity/is-clean";
