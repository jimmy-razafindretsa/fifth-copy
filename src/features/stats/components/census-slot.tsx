import type { Census } from "../view/census";
import { censusShown } from "../view/census-plot";
import { TypistCensus, type TypistCensusProps } from "./typist-census";

export type CensusSlotProps = Omit<TypistCensusProps, "census"> & {
  /** The census read (`getCensus` for the viewer); it streams in its own `Suspense` boundary. */
  read: () => Promise<Census | null>;
};

/**
 * The census section's server slot (#967 C6): awaits the read, then hands the four distributions to
 * the client leaf. Under the floor, under 3 counted races or on a failing read it renders nothing: no
 * placeholder, no error page (the rest of the Personnel file stands on its own).
 */
export async function CensusSlot({ read, ...props }: CensusSlotProps) {
  let census: Census | null;
  try {
    census = await read();
  } catch {
    return null;
  }
  if (!censusShown(census)) return null;
  return <TypistCensus census={census} {...props} />;
}
