---
id: "0015"
title: Avatars are moderated on the host by a local heuristic that flags for human review; no third-party API, no runtime dependency
status: proposed
category: security
scope: ["src/features/identity/avatars/moderation/**", "src/features/identity/avatars/store-avatar.ts", "scripts/avatar-review.ts"]
supersedes: []
rule: Every stored avatar passes the injected AvatarModerator on the re-encoded 256 px image inside storeAvatar before any file is written; approve -> APPROVED, flag -> PENDING (files kept, default portrait for everyone), reject -> typed Rejected error and nothing written; the image never leaves the host and no moderation reason is persisted.
---

# 0015. Avatars are moderated on the host by a local heuristic that flags for human review; no third-party API, no runtime dependency

## Context
Spec 12.2 asks for "a basic filter" on profile pictures (R158, R165). The users are minors (12 to 17, R1), and Law 25 asks for minimal data and no third-party flow that is not necessary (`docs/privacy/`). ADR 0014 (#62) already re-encodes every upload and every OAuth import in `storeAvatar` and left a moderation hook there, after the 256 px WebP is produced and before `store.put`; it also fixed the rule that a refused upload writes nothing and raises a typed error. The operator's side (who reviews, delays, appeals) is `docs/privacy/moderation.md` (#91): "a flag is not proof", "fail safe: hide first, decide after". The human chose the approach on 2026-10-04 (card #64, PLAN question 4): a local heuristic, no third-party API, no ML dependency, flagged avatars stay `PENDING` behind the default portrait until a person reviews them.

## Options
Scores: 1 (poor) to 3 (good) for the project, one VPS, a single operator, users who are minors.

| Option | Privacy for minors | Accuracy | Cost | Dependency weight | Operational load | Outcome |
|---|---|---|---|---|---|---|
| A. Local heuristic (skin-tone ratio + low-entropy check) over the re-encoded image, flags for review | 3: the image never leaves the host | 1: crude, false positives on face close-ups and skin-coloured objects, misses non-skin content | 3: a few ms of CPU per upload | 3: none (`sharp` is already there, ADR 0014) | 2: the operator reviews flagged pictures; the filter never sanctions on its own | **chosen** |
| B. Local model (`nsfwjs` on TensorFlow.js) | 3: on host | 2: better on nudity, blind to hate symbols, personal details, other people's photos | 2: model load and inference CPU on the shared VPS, slower cold start | 1: TensorFlow.js plus model weights (tens of MB), a new runtime dependency (PROTOCOL 5a item 3) | 2: same review, plus model updates | rejected |
| C. Hosted moderation API | 1: every student picture goes to a third party; needs a processor agreement, disclosure and probably consent | 3: best general accuracy | 1: per-call price, an account and a credential to keep | 2: an HTTP client and a secret | 1: vendor outages block or weaken uploads; one more privacy flow to document | rejected |

## Decision
- **Approach:** option A, a local heuristic. **No third-party API**: no picture leaves the server to be checked. **No runtime dependency**: it runs on the raw pixels `sharp` already decodes (ADR 0014); no `nsfwjs`, no `@tensorflow/*`.
- **Interface** (`src/features/identity/avatars/moderation/moderator.ts`), injected into `storeAvatar`:
  ```ts
  type ModerationVerdict = "approve" | "flag" | "reject";
  type ModerationResult = { verdict: ModerationVerdict; reason: ModerationReason };
  interface AvatarModerator { check(image: Buffer): Promise<ModerationResult>; }
  ```
  `image` is the re-encoded 256 px WebP, never the original upload; the moderator gets no user id. A different implementation (a local model later, or a fake in tests) replaces it without touching callers.
- **Heuristic** (`heuristic.ts`): the image is reduced to 64x64 RGB. A pixel is skin-toned when it passes both the RGB rule (R > 95, G > 40, B > 20, max - min > 15, |R - G| > 15, R > G, R > B) and the YCbCr box (77 <= Cb <= 127, 133 <= Cr <= 173). Low entropy is the Shannon entropy of a 32-bin luma histogram (0 to 5 bits).
  - skin ratio >= `SKIN_FLAG_RATIO` (0.5) -> `flag` (`skin`);
  - skin ratio >= `SMOOTH_SKIN_RATIO` (0.25) and entropy < `LOW_ENTROPY_BITS` (1.5) -> `flag` (`smooth-skin`: a large flat skin-toned area);
  - otherwise `approve` (`clear`).
  The heuristic never returns `reject`: it is not proof (`docs/privacy/moderation.md`). The thresholds are exported constants pinned by the table test `moderation/moderator.test.ts`; tuning them is a normal PR that updates this list and the test.
- **Consequences of a verdict** (`storeAvatar`, `moderator.ts` `statusFor`):
  - `approve` -> files written, `avatarStatus = APPROVED`, shown to whoever may see it (ADR 0014 reader).
  - `flag` -> files written, `avatarStatus = PENDING`. The reader serves only `APPROVED`, so a `PENDING` avatar shows the **default portrait** to every viewer, the owner included, until the operator reviews it. The owner is told "your picture is being reviewed" (`settings.avatar.moderation.pending`). A flagged upload replaces a previously approved picture: the owner loses the old one while the new one waits (fail safe).
  - `reject` -> the typed `Rejected` error (ADR 0014's rule for refused uploads), thrown before `store.put`: nothing is written, the previous row and files stay, the owner sees the rejection message and the appeal path (`settings.avatar.moderation.{rejected,appeal}`). An OAuth import that is rejected is skipped (`reason: "rejected"`) and the default portrait stays. Only an operator (or the test fake) produces `reject` today.
- **Review** (`scripts/avatar-review.ts <userId> approve|reject`, after `scripts/db-guard.sh`): `approve` turns a `PENDING` avatar into `APPROVED`; `reject` deletes every file of the user, sets `REJECTED` and clears `avatarKey`. Procedure, delays and appeals: `docs/privacy/moderation.md`.
- **Selection:** `AVATAR_MODERATOR` in `src/env.ts`, `heuristic` (default) or `fake`. `fake` (`fake.ts`) takes its verdict from the image's dominant colour (green approve, blue flag, red reject) so end-to-end tests (#60) can drive both messages. `fake` with `NODE_ENV=production` fails env validation naming the variable, so the app does not start with it.
- **Data:** no moderation reason or score is persisted (Law 25, minimal data); `User.avatarStatus` is the only record. The operator's log lives outside the app (`docs/privacy/moderation.md`).

## Consequences
- Easier: images of minors never leave the host, nothing to pay or to disclose as a processor, no new dependency or credential, and the check is fast enough to run inline in the upload action.
- Harder: accuracy is low. Face close-ups and skin-coloured objects (wood, sand) are flagged and wait for a person, which raises the operator's load; content that is not skin-toned (hate symbols, weapons, personal details) passes and is handled by reports (`docs/privacy/moderation.md`, "Reported approved picture").
- Forbidden: sending avatar bytes to a remote service for moderation, adding an ML runtime dependency without a new ADR, letting the heuristic reject (only flag), persisting the moderation reason, and selecting the fake moderator in production.

## Alternatives considered
- Local model (B) and hosted API (C): rejected, see the options table. A local model can replace the heuristic behind `AvatarModerator` later, with a new ADR (runtime dependency).
- Rejecting on a high skin ratio instead of flagging: rejected, it would punish false positives that a person would approve.
- No automatic check, review on report only: rejected, spec 12.2 asks for a basic filter, and fail safe means hiding before anyone looks.
