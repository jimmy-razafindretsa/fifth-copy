# FIFTH COPY — Character performance audit

These are measured numbers from the current builds: the `Fifth Copy Locker.html` combinations and the LODs in `Clerk v4.html`.

## 1. What one clerk costs

| | Triangles | Vertices | GPU memory* |
|---|---|---|---|
| Lightest outfit (bald/bowl, no glasses, no hat, braces, clean) | 1,922 | 1,532 | ~70 KB |
| Default outfit | 2,650 | 2,003 | ~90 KB |
| **Heaviest outfit** (quiff, round glasses, ushanka, beard) | **2,958** | **2,335** | ~105 KB |
| LOD1 (far seats) | 847 | 756 | ~35 KB |

\* position + normal + colour as Float32 (36 B/vert) plus a Uint16 index.

**Cost of each option compared with the default** (triangles): ushanka +212 · flat cap +196 · eyeshade/beret +156 · quiff +60 · beard +36 · clean shave −160 · no glasses −208 · bowl −232 · braces −128.

## 2. Thirty players in the room

| Scenario | Triangles | Draw calls (clerks only) |
|---|---|---|
| 30 × heaviest, all LOD0 | ~89k | 30 (one mesh per player) |
| 12 near LOD0 + 18 far LOD1 (worst case) | ~51k | 30 → **1 with BatchedMesh** |
| 30 × LOD1 | ~25k | same as above |

**Verdict: you have lots of headroom on triangles.** A school Chromebook or an integrated-GPU laptop handles 150–300k triangles at 60 fps in WebGL. The clerks use about a third of that at worst. Triangles are **not** the bottleneck. The real risks are listed below, in order.

## 3. Real risks, ranked

1. **Customisation breaks instancing.** Every player has a different mesh, so one `InstancedMesh` can no longer draw them all. Without a fix you get 30 draw calls, which is OK but wasteful.
   → Use **`THREE.BatchedMesh`** (three r159+). Add each unique outfit once with `addGeometry` and each player as an instance with `addInstance`. That gives **1 draw call for everyone**, and switching LOD is just `setGeometryIdAt(i, lodId)`.
2. **Animation.** The clerk is merged into one static mesh, so his arms and head can't move while typing.
   → Build each outfit as **4 rigid pieces**: body, head (with hair, hat, glasses and face), left arm and right arm. Put them in the same BatchedMesh as 4 instances per player. That's 120 matrix updates per frame, which costs almost nothing, and it stays at 1 draw call. Do **not** use 4 separate meshes per player (120 draw calls, too many on low-end machines).
   → An alternative is skinning: 1 mesh with 4 bones and rigid weights. It works too, but BatchedMesh is simpler and batches better.
3. **Shadows.** A real-time shadow map draws every clerk a second time.
   → On low settings, use a flat dark circle under each clerk instead (1 extra instanced quad).
4. **Screen resolution (pixelRatio).** On retina or 4K Chromebooks this costs more than any triangle count.
   → Cap it per preset (see section 5).
5. **Rebuild cost.** `build() + merge()` runs in JS and takes about 2–5 ms per outfit.
   → Run it **only when a player joins or changes outfit**, never every frame. Cache the result by outfit key, since two players with the same outfit share one mesh. Dispose of old geometry (the locker already does this).
6. **Network.** Send the **outfit config**, never the mesh: `{h:2,g:0,t:1,c:3,f:0,hc:1}` is about 6 bytes. Each client builds the mesh locally.

## 4. Possible extra savings (not needed yet)

- **Quantise vertex data.** Store colour as `Uint8 normalized` and normals as `Int8 normalized`. That goes from 36 B to 18 B per vertex, about half the GPU memory.
- **LOD1 in the locker pipeline.** It currently exists only in v4. Port `lowGeo()` so customised outfits also get a far version. Hats and hair colour must survive LOD1, because they are how players recognise each other from across the room.
- **LOD2 for 30+ players or spectator view.** A ~150-triangle stand-in (head sphere + body lathe + hat block, 6 segments). Optional.
- **Merge the room into a few meshes per material.** v6 already bakes its static meshes. Keep the whole room under ~40 draw calls.

## 5. Suggested quality presets

| Setting | LOW (Chromebook) | MEDIUM (default) | HIGH |
|---|---|---|---|
| pixelRatio cap | 1.0 | 1.5 | min(device, 2) |
| Antialias | off (FXAA off) | MSAA 4× | MSAA 4× |
| Clerk LOD0 seats | nearest 4 | nearest 12 | all |
| Clerk LOD1 seats | the rest | the rest | — |
| Shadows | blob circles | 1 directional, 1024 map, clerks only | 2048 map, clerks + desks |
| Material | Lambert | Lambert | Standard (roughness) |
| Room props | baked, no small clutter | baked + clutter | full |
| Typing animation | head + arms, 30 fps update for far clerks | full, 60 fps | full |
| Target | 60 fps @ 720p | 60 fps @ 1080p | 60 fps @ 1440p |

**Rough frame budget (MEDIUM, 30 players):** clerks ~51k triangles + room ~40–60k + typewriters ~20k ≈ **~130k triangles and ~50 draw calls**. That is comfortable for WebGL on school hardware.

## 6. Pipeline summary for the dev team

```
outfit config (6 bytes) ──network──▶ build(cfg) → 4 rigid parts × {LOD0, LOD1}
                                      │ cache by config key
                                      ▼
                         BatchedMesh.addGeometry (once per unique outfit/LOD/part)
                         BatchedMesh.addInstance  (4 per player)
per frame: setMatrixAt (arms/head anim) · setGeometryIdAt (LOD by camera distance)
            → 1 draw call for all clerks
```
