#!/usr/bin/env bash
# Exits non-zero unless DATABASE_URL (or the URL given as $1) points at a local or designated test host.
# Run before any DB command (AGENTS.md, Prisma hazards). Never prints the URL itself.
set -euo pipefail
# shellcheck source=lib/dotenv-get.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/dotenv-get.sh"

if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="$(dotenv_get DATABASE_URL)"
fi
url="${1:-${DATABASE_URL:-}}"
if [[ -z "$url" ]]; then
  echo "db-guard: DATABASE_URL is not set" >&2
  exit 2
fi

# postgresql://user:pass@host:port/db?params -> host. Mirror the URL parsers (WHATWG URL,
# pg-connection-string, Prisma): the authority ends at the first / ? or #, and the host follows
# its LAST "@" (a password may contain "@" or ":").
rest="${url#*://}"
authority="${rest%%[/?#]*}"
hostport="${authority##*@}"
# Fail closed on libpq-style multi-host authorities (host1:p1,host2:p2) and percent-encoded hosts:
# a parser may connect to a host the comparison below never sees. Never print the authority.
if [[ "$hostport" == *,* || "$hostport" == *%* ]]; then
  echo "db-guard: REFUSED. Connection URL authority lists several hosts or is percent-encoded." >&2
  exit 1
fi
host="${hostport%%:*}"
if [[ "$hostport" == \[* ]]; then host="${hostport%%]*}]"; fi

# Fail closed on query keys that can redirect the connection (pg-connection-string and libpq read
# host/hostaddr/port/service/dbname from the query, overriding the authority). Keys are compared
# case-insensitively; percent-encoded keys are refused outright, since parsers decode them.
# Never print the query: it may carry a password.
if [[ "$rest" == *\?* ]]; then
  query="${rest#*\?}"
  query="${query%%#*}"
  IFS="&" read -r -a pairs <<< "$query"
  for pair in "${pairs[@]+"${pairs[@]}"}"; do
    key="$(printf '%s' "${pair%%=*}" | tr '[:upper:]' '[:lower:]')"
    case "$key" in
      *%*|host|hostaddr|port|service|servicefile|dbname|socket)
        echo "db-guard: REFUSED. Connection URL query overrides the target (host, port, service or encoded key)." >&2
        exit 1
        ;;
    esac
  done
fi

allowed=("localhost" "127.0.0.1" "[::1]" "::1")
extra=(); IFS="," read -r -a extra <<< "${DB_GUARD_ALLOWED_HOSTS:-}"
# Trim spaces and tabs around each entry ("postgres, ci-db"); a blank entry stays empty and never matches.
for e in "${extra[@]+"${extra[@]}"}"; do
  e="${e#"${e%%[![:blank:]]*}"}"
  allowed+=("${e%"${e##*[![:blank:]]}"}")
done

for a in "${allowed[@]}"; do
  if [[ -n "$a" && "$host" == "$a" ]]; then
    echo "db-guard: ok (host=$host)"
    exit 0
  fi
done
echo "db-guard: REFUSED. Host '$host' is not local or an allowed test host." >&2
exit 1
