"use server";

import { NotImplementedError } from "@/lib/errors";
import type { CreateLobbyResult } from "../types";

// Creates a lobby and opens its room on the race server. Stub: behaviour lands in #103.
export async function createLobby(): Promise<CreateLobbyResult> {
  throw new NotImplementedError("#103");
}
