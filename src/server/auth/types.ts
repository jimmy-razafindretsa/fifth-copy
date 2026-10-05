// The only identity shape the app sees (ADR 0009).
export type Viewer = {
  id: string;
  name: string;
  isGuest: boolean;
  hasAvatar: boolean;
};

// Resolves the current viewer from one source (session, guest cookie), or null.
export type ViewerResolver = () => Promise<Viewer | null>;
