# Backup retention

Placeholder written by #71, mechanism and location set by #705 (ADR 0019, "Backups"); #81 completes it (how a
deletion is confirmed purged, restore drill cadence once agreed).

- **What is backed up:** the Postgres database (its whole Railway volume) and the avatar volume (`avatars`, ADR 0014).
  Redis holds no durable data and is not backed up (ADR 0008).
- **Mechanism:** Railway volume backups, one **Daily** schedule per volume. Railway keeps each daily backup 6 days,
  then deletes it. Weekly and monthly schedules, point-in-time recovery and backup locks stay off: each would keep
  copies past the window below. A manual backup (for example a restore drill) is deleted the same day.
- **Where:** inside Railway, attached to each volume, in the same project, environment (`production`) and region
  (`sfo`, US West) as the live data, not in a separate bucket or provider. Railway encrypts them at rest (AES-256,
  Railway-held keys). Hosting outside Québec is assessed by the PIA card, not here.
- **Window:** 14 days, the period in [retention.md](retention.md); the 6-day rotation sits inside it. A deleted
  account is gone from every backup once the window has passed after its deletion.
- **Restore:** in place, on the same service; the volume it replaces stays unmounted until the operator deletes it,
  within the window. Steps: [docs/ops/backup-restore.md](../ops/backup-restore.md). A restore brings back accounts
  deleted after the backup; the operator purges them again before reopening (#81).
- **Purge:** backups are not edited one by one; they age out with the rotation above (ADR 0019, #403).
