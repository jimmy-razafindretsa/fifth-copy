import "server-only";
import { UnauthenticatedError } from "./errors";
import { viewerResolvers } from "./resolvers";
import type { Viewer, ViewerResolver } from "./types";

// Tries each resolver in order and returns the first non-null viewer.
export async function resolveViewer(resolvers: readonly ViewerResolver[]): Promise<Viewer | null> {
  for (const resolve of resolvers) {
    const viewer = await resolve();
    if (viewer) return viewer;
  }
  return null;
}

export function getViewer(): Promise<Viewer | null> {
  return resolveViewer(viewerResolvers);
}

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw new UnauthenticatedError();
  return viewer;
}
