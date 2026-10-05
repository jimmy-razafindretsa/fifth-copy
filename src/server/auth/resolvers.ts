import type { ViewerResolver } from "./types";

// Ordered chain read by getViewer; the first non-null viewer wins.
// Extension point: #38 prepends the Auth.js session resolver, #32 appends the
// guest cookie resolver. Add resolvers here; never change a signature.
export const viewerResolvers: readonly ViewerResolver[] = [];
