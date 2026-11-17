// Server-only results API (ADR 0021): what server code of other features (the worker's jobs among
// them) may import beside `index.ts`. Kept free of components and request code, so the worker bundle
// (scripts/build-worker.mjs) does not pull the report screens in.
import "server-only";

// The races stats and results count (#613): never a voided or open one.
export { COUNTED_RACE } from "./queries/counted-races";
// A stored trace ready to replay: keystrokes, effective text, engine settings (#314).
export { storedReplay, type StoredReplay, type StoredTrace } from "./stored-replay";
