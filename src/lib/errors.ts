// Thrown by typed stubs whose behaviour lands in a later card. Carries only the card id,
// never request data.
export class NotImplementedError extends Error {
  constructor(card: string) {
    super(`Not implemented (${card})`);
  }

  // On the prototype, not an own property: the instance has no enumerable keys.
  override get name() {
    return "NotImplementedError";
  }
}
