---
id: "0013"
title: three.js lives only in src/features/race-3d, loaded lazily on the race route; all text and input are HTML; budgets are tested
status: accepted
category: ui
scope: ["src/features/race-3d/**", "src/features/race/**", "src/app/race/**", "e2e/perf/**"]
supersedes: []
rule: WebGL code is confined to src/features/race-3d (client-only, next/dynamic with ssr:false, imported only by the race route after the HUD mounts); the telex strip, typed sheet, keyboard, counters, race card, stamps and plaques are HTML overlays driven by the same race store; the scene reads the store and never owns state; bundle, fps and draw-call budgets are checked in CI.
---

# 0013. three.js lives only in `src/features/race-3d`, loaded lazily on the race route; all text and input are HTML; budgets are tested

## Context
60 fps on mid laptops, 30 fps on Chromebooks (R99), instancing, LODs and impostors past 40 players with at most 60 draw calls (R100), a 2-second GPU benchmark choosing a quality preset (R101), all text in HTML so input never lags (R102), three.js loaded only on the race screen (R103), WebGL-unavailable fallback (card #213). Cards #253, #275-#278.

## Decision
- **Two features, one store.** `src/features/race` owns the socket client, the race store (Zustand-style, plain React state with `useSyncExternalStore`), the local engine prediction (ADR 0007) and every HTML HUD element. `src/features/race-3d` owns the scene: room, ring, typists, the Major, props, cameras, lamp, quality presets. The scene subscribes to the store (positions, statuses, overtakes) and emits nothing but camera telemetry for the fps test.
- **Loading:** the race page renders the HUD first; the scene is `next/dynamic(() => import("@/features/race-3d"), { ssr: false })` behind a loading card ("Did you know?" cards, R10). `three` and loaders are in that chunk only; a bundle check (`e2e/perf/bundle.spec.ts`) fails if `three` appears in any other route chunk.
- **HTML layer:** rank plaques, desk numbers and names are `CSS2D`-style HTML positioned from projected 3D coordinates; no WebGL text (critic gap in the board record).
- **Budgets in CI** (`e2e/perf/`, Chromium with software GL): a 60-player bot room at the Low preset renders >= 30 fps median over 10 s and <= 60 draw calls; the race route's first-load JS without the 3D chunk stays under 250 kB gzip; time from landing to a started bot race under 60 s (R4, card #278).
- **Fallback:** no WebGL2 or benchmark below the Low threshold shows a 2D "paper" race view with the same HUD; the race is fully playable without the scene.
- **Spectator views** (projector, phone) reuse `race-3d` with the overview camera and the HUD in sidebar mode; phones never mount the typing surface.

## Consequences
- A UI card can touch the HUD without loading WebGL; a 3D card can be verified with the bot room and the perf spec, no humans needed.
- Two client-heavy features: both are `"use client"` leaves under a server-rendered race route.

## Alternatives considered
- **react-three-fiber:** declarative and nice, but adds a reconciler on the hot path and a dependency; imperative three.js with one `RaceScene` class is enough for one scene. Rejected for now.
- **Text in WebGL (SDF):** sharp enough, but input latency and accessibility suffer and the spec forbids it. Rejected.
- **Canvas 2D race view only:** cheapest, but the 3D room is a core part of the approved art direction. Kept as the fallback.
