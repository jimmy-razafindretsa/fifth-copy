# Retention schedule

How long Fifth Copy keeps each kind of personal information, and what enforces it. Card #71 (epic #29).
Requirements: R152, R164. Index: [README](README.md). What each item contains: [inventory.md](inventory.md).

This file is the only place where retention periods are decided. Other files quote them (the privacy page #76, the
guest purge job #86, the parent letter in consent.md, pia.md, backup-retention.md); when a period changes here, they
change in the same PR.

Law 25 asks that personal information be destroyed (or anonymised) once the purpose it was collected for is
achieved (s. 23). The periods below are the project's reading of "no longer than needed" for a typing game used by
minors. The guest period was decided by the operator; the others come from the ADRs and cards named in each row.
They are the project's choices, not legal advice.

## Periods

| Data | Period | Enforced by |
|---|---|---|
| Inactive guest accounts and everything attached to them | 12 months (365 days) without any activity (no race, sign-in or settings change) | #86 weekly worker job (ADR 0011), through the deletion of #81 |
| Accounts (username or GitHub/Discord sign-in) and everything attached to them: results, stats, personal bests, achievements, preferences, avatar | Until the student deletes the account, or it is deleted on request through the teacher or school | #81 (self-service and assisted deletion) |
| Guest cookie in the browser | At most 1 year; it identifies nothing once the guest account is deleted | `src/server/auth/guest-cookie.ts` (cookie expiry), #81 clears it |
| Session cookie | Until sign-out or expiry | #38 (Auth.js JWT, ADR 0009), #81 clears it |
| Avatars | Until replaced, rejected or the account is deleted; rejected files are deleted at once | ADR 0014, #64, #81 |
| Raw keystrokes | 30 days after the race | ADR 0008, #315 (worker purge) |
| Request logs and IP addresses | 30 days | #403 (log rotation), #420 (structured logs with PII redaction) |
| Lobbies | 24 hours after the lobby closes | ADR 0008, #143 (expiry sweep) |
| Invites | 24 hours, or as soon as the invite is used | ADR 0008 (Redis TTL) |
| Live rooms | 1 hour after the last activity in the room | ADR 0008 (Redis TTL) |
| Presence and reconnection keys | 2 minutes | ADR 0008 (Redis TTL) |
| Rate limits | The length of each limit window (minutes) | ADR 0008, #207 |
| Job records | Until the job ends and the account is deleted; exact period set by the card that creates `JobRun` | ADR 0011, #81 deletion step |
| Backups | 14 days, then overwritten; a deleted account disappears from backups within 14 days of its deletion | ADR 0012, #403, [backup-retention.md](backup-retention.md) (#81) |
| Moderation log entries | 12 months after the decision, or when the account is deleted, whichever comes first | The operator, by hand ([moderation.md](moderation.md)) |
| Requests to the person in charge | 12 months after the answer, so a later complaint to the Commission d'accès à l'information can be answered with the record. Decided by the person in charge (Jimmy Razafindretsa) on 2026-10-06 | The person in charge, by hand ([responsible.md](responsible.md)) |

## What "deleted" means

- Database rows are deleted, not hidden. Deleting an account removes every row that points to it in one
  transaction and then its avatar files (#81).
- Copies in backups are not edited one by one; they age out with the backup rotation above.
- Statistics that no longer point to a person (for example a count of races per day) are not personal information
  and are not covered by this schedule.

## Changing a period

Change the table above in a PR that also updates the code that enforces it and the privacy page text (#76). A
shorter period is always allowed. A longer one needs a reason written in the PR and a new review of the
[PIA](pia.md).
