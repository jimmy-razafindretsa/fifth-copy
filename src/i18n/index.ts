import "server-only";
import { en } from "./en";

export type Messages = typeof en;

/**
 * Server-side catalog lookup (ADR 0010). English only until #372 reads the locale cookie; async now
 * so that change touches no call site.
 */
export async function getT(): Promise<Messages> {
  return en;
}
