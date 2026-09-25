#!/usr/bin/env bash
# Recria um banco local, aplica todas as migrações em ordem e roda os testes SQL.
#
# Uso: scripts/db-test.sh
# Variáveis: PGHOST (padrão /tmp), PGPORT (padrão 54329), PGUSER (padrão postgres),
#            DB_NAME (padrão nexa_test)
set -euo pipefail

export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-54329}"
export PGUSER="${PGUSER:-postgres}"
DB_NAME="${DB_NAME:-nexa_test}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

psql -q -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME}" -c "CREATE DATABASE ${DB_NAME}"

run() { PGOPTIONS="-c client_min_messages=warning" psql -q -X -v ON_ERROR_STOP=1 -d "${DB_NAME}" "$@"; }

run -f "${ROOT}/supabase/tests/bootstrap.sql"

for f in "${ROOT}"/supabase/migrations/*.sql; do
  # pg_cron e pg_net só existem no Supabase; localmente essas linhas são ignoradas.
  if grep -qiE 'EXTENSION.*(pg_cron|pg_net)' "$f"; then
    sed -E '/EXTENSION.*(pg_cron|pg_net)/Id' "$f" | run -f - || { echo "Falhou: $f"; exit 1; }
  else
    run -f "$f" || { echo "Falhou: $f"; exit 1; }
  fi
done
echo "Migrações aplicadas: $(ls "${ROOT}"/supabase/migrations/*.sql | wc -l)"

status=0
for t in "${ROOT}"/supabase/tests/[0-9]*.sql; do
  [ -e "$t" ] || continue
  if run -o /dev/null -f "$t"; then echo "OK   $(basename "$t")"; else echo "FALHA $(basename "$t")"; status=1; fi
done
exit $status
