#!/usr/bin/env bash
# Testa o isolamento pela API (PostgREST, a mesma usada pelo Supabase), com JWT e cabeçalho
# x-empresa-id. Pré-requisito: Postgres local (ver scripts/db-test.sh).
set -euo pipefail

export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-54329}" PGUSER="${PGUSER:-postgres}"
export DB_NAME="${DB_NAME:-nexa_api_test}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${ROOT}/.cache/postgrest"
VERSAO="v12.2.3"
PORTA="${PGRST_PORT:-3999}"

"${ROOT}/scripts/db-test.sh" >/dev/null
PGOPTIONS="-c client_min_messages=warning" psql -q -X -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${ROOT}/supabase/tests/api/seed.sql"

if [ ! -x "${CACHE}/postgrest" ]; then
  mkdir -p "${CACHE}"
  curl -sSL "https://github.com/PostgREST/postgrest/releases/download/${VERSAO}/postgrest-${VERSAO}-linux-static-x64.tar.xz" \
    | tar -xJ -C "${CACHE}"
fi

CONF="$(mktemp)"
cat > "${CONF}" <<CFG
db-uri = "postgres://authenticator@localhost:${PGPORT}/${DB_NAME}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "segredo-de-teste-local-com-mais-de-32-caracteres"
server-port = ${PORTA}
CFG

"${CACHE}/postgrest" "${CONF}" > "${CONF}.log" 2>&1 &
PID=$!
trap 'kill ${PID} 2>/dev/null; rm -f "${CONF}" "${CONF}.log"' EXIT
for _ in $(seq 1 30); do
  curl -s "http://localhost:${PORTA}/" >/dev/null 2>&1 && break
  sleep 0.3
done

PGRST_URL="http://localhost:${PORTA}" node "${ROOT}/supabase/tests/api/isolamento.test.mjs"
