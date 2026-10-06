# shellcheck shell=bash
# dotenv_get KEY [FILE]: print KEY's value from FILE (default .env) the way dotenv 18 parses it,
# for the subset the kit needs: optional leading blanks and "export ", blanks around "=", values
# quoted with " ' or ` (quotes removed) or unquoted (trimmed, trailing CR removed); "#" lines never
# match. A repeated key keeps its LAST value, like dotenv.parse (the value Prisma and Next.js use).
# Prints nothing and returns 0 when the file or the key is missing.
dotenv_get() {
  local key="$1" file="${2:-.env}" line value found=""
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:blank:]]*}"}"
    [[ "$line" == export[[:blank:]]* ]] && line="${line#export}" && line="${line#"${line%%[![:blank:]]*}"}"
    [[ "$line" == "$key"*=* ]] || continue
    value="${line#"$key"}"
    value="${value#"${value%%[![:blank:]]*}"}"
    [[ "$value" == =* ]] || continue
    value="${value#=}"
    value="${value#"${value%%[![:blank:]]*}"}"
    value="${value%"${value##*[![:blank:]]}"}"
    case "$value" in
      \"*\" | \'*\' | \`*\`) [[ ${#value} -ge 2 && "${value:0:1}" == "${value: -1}" ]] && value="${value:1:${#value}-2}" ;;
    esac
    found="$value"
  done < "$file"
  printf '%s' "$found"
}
