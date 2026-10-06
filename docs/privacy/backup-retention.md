# Backup retention

Placeholder written by #71; #81 owns and completes this file.

Only the values already decided are stated here, so the privacy file's index ([README](README.md)) links a real file.
Card #81 completes it (encryption at rest, rotation details, location, restore drill cadence, how a deletion is
confirmed purged).

- **What is backed up:** the Postgres database (nightly `pg_dump`) and the avatar volume (ADR 0012, ADR 0014).
- **Where:** off the server, in a bucket; the provider and its location are not decided yet (#445).
- **Window:** 14 days, the period in [retention.md](retention.md). A deleted account is gone from every backup once
  the window has passed after its deletion.
- **Purge:** backups are purged on the same schedule as deleted user data (ADR 0012, #403).
