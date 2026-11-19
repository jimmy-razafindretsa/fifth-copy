---
id: "0026"
title: A feature may expose a light client door, client.ts; a cookieless `/` is served the landing-only route module
status: proposed
category: architecture
scope: ["src/features/*/client.ts", "src/proxy.ts", "src/lib/visitor-home.ts", "src/app/page.tsx", "src/app/welcome/**", "src/app/_components/landing-view.tsx", ".dependency-cruiser.cjs", "scripts/landing-bundle.ts", "scripts/lighthouse.ts"]
supersedes: []
rule: A route that must stay light imports feature UI through `<feature>/client.ts` (nothing reachable from it is a lobby store, the race socket client, socket.io or a server.ts; dependency-cruiser `feature-client-entry-light`); the proxy serves a GET of `/` without a session or guest cookie from `/welcome` by a rewrite on cookie presence only, and `scripts/landing-bundle.test.ts` checks that module's client graph carries no lobby store, race socket or zod.
---

# 0026. A light client door, `client.ts`, and the visitor/viewer split of `/`

## Context
#954 / #999 group 7 (C56-C59): the visitor landing must reach Lighthouse mobile 90 and ship no lobby store, race socket client or zod. Two forces:
- ADR 0001 (with 0021) gives a feature two doors: `index.ts` (client-safe, but it re-exports the whole feature, the live lobby and its store included, and runs the guest-merge registration) and `server.ts` (server only). Nothing says which exports are *light*: a landing that imports `QuickRaceButton` from `@/features/lobby` stays light only by luck of what its client components import today.
- `/` is one route module for two audiences (#943): the viewer's Home menu and the visitor's landing. Next builds one client manifest per page module, so the visitor's first load carries the Home menu's client components too, and anything they later import.

## Decision
- **Client door.** A feature may add a third public entry, `src/features/<f>/client.ts`, re-exporting only UI meant for light routes (landing entry controls; later the lobby `SeatRing` slot). Dependency-cruiser accepts it as a cross-feature and route target (`feature-public-api-only`, `app-feature-public-api-only`) and forbids anything reachable from it to be the lobby store, the race socket client, socket.io/engine.io or any `server.ts` (`feature-client-entry-light`). `client.ts` has no side-effect import. Zod is checked by `scripts/landing-bundle.test.ts` instead: a server action reached from a door uses zod on the server only, and dependency-cruiser reachability cannot stop at a `"use server"` module.
- **Visitor/viewer split.** `src/proxy.ts` rewrites (not redirects: the URL stays `/`) a GET or HEAD of `/` that carries neither an Auth.js session cookie nor the guest cookie to `/welcome` (`VISITOR_HOME`, `src/lib/visitor-home.ts`), the landing-only module. `/` keeps the Home menu and still renders the landing for a stale cookie that resolves to nobody. Server action POSTs are never rewritten. The landing module takes lobby UI only through `lobby/client.ts` (`visitor-landing-light-doors`).
- **Checks.** `scripts/landing-bundle.test.ts` rebuilds the client graph of the visitor module from the production build's client reference manifest (its `"use client"` boundaries, followed through the source, stopping at type-only imports and server actions) and scans its first-load chunks for zod and Socket.IO fingerprints. `scripts/lighthouse.ts` measures the mobile performance median on the production build.
- This **amends ADR 0001** (public doors: index.ts, server.ts per 0021, now client.ts) without superseding it. For ADR 0009 it adds one rewrite to the proxy's optimistic redirects: it routes on cookie presence only, decodes and trusts nothing, and every page and action still resolves the viewer with `getViewer`.

## Consequences
- The visitor's first load is the landing's own client code; the Home menu's grows without touching it.
- Light routes have a named, machine-checked door; adding a heavy export to `client.ts` fails `scripts/check.sh boundaries`.
- A cookieless `/` and `/welcome` render the same module; analytics and logs see `/` (the rewrite keeps the URL).
- A new identity cookie must be added to the proxy's list, or its holder would be served the landing at `/` (the same list already gates `/settings`, `/profile`, `/locker`).

## Alternatives considered
- Only a `client.ts` door, `/` unsplit: the visitor still downloads the Home menu's client components.
- `next/dynamic` for the Home menu inside `/`: the page's client manifest still lists its client references; the split would depend on bundler internals.
- Serve the landing at `/` and move the Home menu to another URL: breaks #943 C1 (`/` is the Home menu for a viewer).
