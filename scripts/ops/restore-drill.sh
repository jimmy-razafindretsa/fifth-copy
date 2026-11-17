# Restore drill runner (#705, docs/ops/backup-restore.md section 3). Runs inside a throwaway Railway service
# from image postgres:<major of production>, with SOURCE_URL = ${{Postgres.DATABASE_URL}}. Starts a private Postgres
# in the container (no volume, no network listener), streams pg_dump of production into it and prints
# counts only: never a row, a value or the URL.
set -u
echo "DRILL start $(date -u +%FT%TZ)"
export PGDATA=/tmp/pgdrill
mkdir -p "$PGDATA" && chown postgres "$PGDATA"
su postgres -c "initdb -D $PGDATA -A trust >/dev/null && pg_ctl -D $PGDATA -o \"-c listen_addresses='' -k /tmp\" -w start >/dev/null" || { echo "DRILL FAIL local server"; exit 1; }
T="postgresql://postgres@/postgres?host=/tmp"
t0=$(date +%s)
pg_dump --no-owner --no-acl "$SOURCE_URL" 2>/tmp/dump.err | psql -q -v ON_ERROR_STOP=0 "$T" >/dev/null 2>/tmp/restore.err
echo "DRILL dump_exit=${PIPESTATUS[0]} restore_exit=${PIPESTATUS[1]} seconds=$(( $(date +%s) - t0 ))"
echo "DRILL dump_err_lines=$(wc -l </tmp/dump.err) restore_err_lines=$(wc -l </tmp/restore.err)"
q(){ psql -tAc "$2" "$1" 2>&1 | head -1; }
echo "DRILL migrations_finished=$(q "$T" "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
echo "DRILL migrations_unfinished=$(q "$T" "select count(*) from _prisma_migrations where rolled_back_at is null and finished_at is null")"
for tb in User Lobby Race; do
  echo "DRILL $tb restored=$(q "$T" "select count(*) from \"$tb\"") source=$(q "$SOURCE_URL" "select count(*) from \"$tb\"")"
done
echo "DRILL end $(date -u +%FT%TZ)"
