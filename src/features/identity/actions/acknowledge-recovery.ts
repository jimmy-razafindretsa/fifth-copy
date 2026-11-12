"use server";

import { redirect } from "next/navigation";
import { dropReveal } from "../recovery/reveal";

/** The reveal's "I wrote it down" (#46 C2): deletes the one-shot cookie, then the landing. */
export async function acknowledgeRecovery(): Promise<void> {
  await dropReveal();
  redirect("/");
}
