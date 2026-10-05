// Thrown by requireViewer when no viewer is resolved. Takes no arguments so it
// can never carry request data (cookies, headers, ids) into logs or responses.
export class UnauthenticatedError extends Error {
  constructor() {
    super("Unauthenticated");
  }

  // On the prototype, not an own property: the instance has no enumerable keys.
  override get name() {
    return "UnauthenticatedError";
  }
}
