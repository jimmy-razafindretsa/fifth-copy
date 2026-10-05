// Public identity API (ARCHITECTURE 8.2). Server-only at runtime: client
// components may only `import type { Viewer }` from here.
export { getViewer, requireViewer, UnauthenticatedError, type Viewer } from "@/server/auth";
