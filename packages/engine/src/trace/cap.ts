/** Keystrokes a desk may store per character of the race text (typing, errors, corrections). */
export const TRACE_KEYS_PER_CHAR = 4;
/** Fixed allowance on top, for short texts and many corrections. */
export const TRACE_ALLOWANCE = 1_000;
/**
 * The most keystrokes one desk's trace holds for a text of `textLength` characters: the race server
 * stops tracing beyond it, on the desk's effective text (#173, #190), and the web refuses a stored
 * trace above it, on the base text plus the largest overlay the wire allows (#189, #190).
 */
export const traceCapOf = (textLength: number) =>
  TRACE_KEYS_PER_CHAR * textLength + TRACE_ALLOWANCE;
