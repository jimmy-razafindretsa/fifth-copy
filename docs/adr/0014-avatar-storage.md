---
id: "0014"
title: Avatars are re-encoded WebP files on a private volume, written only by the web app and served only through /api/avatars/[userId]
status: accepted
category: data
scope: ["src/features/identity/avatars/**", "src/app/api/avatars/**", "deploy/**"]
supersedes: []
rule: Avatar bytes enter only through storeAvatar (magic-byte sniff, sharp decode with limitInputPixels and pages 1, square crop, WebP 256 and 64 px, metadata stripped) and leave only through /api/avatars/[userId] after an authorization check; files live under AVATAR_DIR behind the AvatarStore interface, keyed <userId>/<version>-<size>.webp from validated ids, never from user input; Postgres keeps avatarKey and avatarStatus as the record.
---

# 0014. Avatars are re-encoded WebP files on a private volume, written only by the web app and served only through /api/avatars/[userId]

## Context
Typists (guests and accounts, many of them minors) may upload a profile picture (R157, R158) that only people sharing a lobby with them can see (R163). ADR 0009 decided that avatars are private files behind a membership-checking route and left the storage backend to this ADR (card #59, merged into #62). ADR 0008 makes Postgres the only system of record; ADR 0012 runs everything on one VPS with Docker Compose and backs up Postgres nightly. An uploaded image is untrusted input: decompression bombs, polyglot files, SVG script smuggling, EXIF GPS data and path tricks in file names are all on the table. The human approved the runtime dependency `sharp` on 2026-10-04 (PROTOCOL 5a item 3) and chose a Compose volume for the files.

## Decision
- **Where:** files on disk under `AVATAR_DIR` (`src/env.ts`). In production it is a named Compose volume mounted at `/data/avatars` in the `web` container (the Compose file sets `AVATAR_DIR=/data/avatars`, card #403). Outside production the default is `.data/avatars` under the working directory (gitignored), so a developer machine never needs `/data`.
- **Layout:** one directory per user, two files per version: `<userId>/<version>-256.webp` and `<userId>/<version>-64.webp`. `<version>` is a millisecond timestamp and doubles as the cache buster. `User.avatarKey` stores `<userId>/<version>`; `User.avatarStatus` (`NONE|PENDING|APPROVED|REJECTED`) stores the moderation state (schema from #31). Postgres stays the record (ADR 0008): a file with no matching `avatarKey` is an orphan and is never served.
- **Interface:** `AvatarStore { put(userId, version, files), get(userId, version, size), delete(userId, { keep? }) }` in `src/features/identity/avatars/store.ts`, with `AvatarSize = 64 | 256`. The only implementation is `FsAvatarStore(root)` (`fs-store.ts`): ids are checked against a strict pattern, every resolved path must stay inside `root`, writes go to a temp file then `rename`, and the directory is created on first write. An object store can replace it later without touching callers.
- **Pipeline (`storeAvatar`, `store-avatar.ts`):** size cap 5 MB before decoding -> type from magic bytes only (JPEG, PNG, WebP, GIF; never the extension or declared MIME type) -> `sharp` decode with `limitInputPixels` (25 MP), `pages: 1` (first frame of GIF/animated WebP) and EXIF auto-orientation -> the decoder's format must equal the sniffed one (polyglot defence) -> at least 64x64 px -> the user's square crop must lie inside the oriented image -> extract, resize to 256 and 64 px, encode WebP; `sharp` drops EXIF, XMP and ICC by default and we never call `withMetadata` -> `AvatarModerator` hook (a no-op that approves, until #64) -> `store.put` -> caller commits the new key to Postgres -> previous versions are deleted. A rejected upload writes nothing and raises a typed error (`TooLarge`, `WrongType`, `TooSmall`, `Undecodable`, `BadCrop`) that callers map to bilingual messages.
- **Writer:** only the web app, through the `uploadAvatar` server action (`requireViewer`, guests allowed; it ignores any user id in the form and always writes the viewer's own row). Next's server-action body limit is raised to 6 MB in `next.config.ts` so the 5 MB contract is reachable (multipart overhead included); rate limiting is the shared limiter's job (#90).
  Second writer (#52): `importOauthAvatar` on a first OAuth sign-in, same `storeAvatar` pipeline with a centered square crop; it fetches only `https` URLs on the exact hosts `avatars.githubusercontent.com` and `cdn.discordapp.com` (default port, no userinfo, no redirects, 5 s, 5 MB streamed cap, `image/*`), writes the row only while `avatarKey` is still null, and never persists the provider URL.
- **Reader:** only `GET /api/avatars/[userId]?size=64|256&v=<version>`. It serves the file when the viewer may see it (the owner now; lobby members with #65), the status is `APPROVED` and `v` matches `avatarKey`; everything else is `404` (no oracle), a bad `size` or `v` is `400`. Headers: `Content-Type: image/webp`, `Cache-Control: private, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`. Caddy never serves the volume directly.
- **Backups and deletion (extends ADR 0012):** the avatar volume joins the nightly backup scope next to `pg_dump`, same off-box bucket, same 14-day retention and purge schedule (#407, window from #81), so the files and the keys that reference them are restored together. `deleteMyData` (#81) calls `AvatarStore.delete(userId)`, which removes the whole `<userId>/` directory. ADR 0012's backup bullet only names `pg_dump`; this ADR widens that scope, it does not change the mechanism.

## Consequences
- Easier: no extra credentialed service, images of minors never leave the host, one backup job covers both the keys and the files, and every byte served was produced by our encoder (no user-supplied bytes are ever served).
- Harder: the `web` container is no longer stateless; it needs the volume mounted and must run on one host (already true, ADR 0012). The standalone Docker image must ship `sharp`'s platform binaries (`@img/sharp-linux-*`), card #403.
- Ordering is write new files, update the row, delete old files: a crash in between leaves orphans that are never served and are removed by the next upload or by `deleteMyData`.
- Forbidden: serving avatars from `public/` or through Caddy, building a path from request input, storing the original upload, or calling `withMetadata`.
- Privacy notes and moderation rules live under `docs/privacy/` (#91, #64).

## Alternatives considered
- **S3-compatible object storage:** another credentialed service to run and rotate, and minors' images leaving the host for one school. Rejected for now; `AvatarStore` keeps the door open.
- **`bytea` in Postgres:** one store and transactional, but it bloats every backup and the row cache with binary data that is read on every lobby render. Rejected.
- **Serving files straight from a static directory:** cannot check lobby membership (R163). Rejected.
- **`file-type` for detection:** a second runtime dependency for four signatures; a 20-line sniffer plus the decoder's own format check is enough. Rejected.
