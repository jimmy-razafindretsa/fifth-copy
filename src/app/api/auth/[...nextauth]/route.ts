import { handlers } from "@/server/auth";

// Auth.js endpoints (#786, ADR 0009): session, csrf, providers, signin/signout and callbacks.
export const { GET, POST } = handlers;
