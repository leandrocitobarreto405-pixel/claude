#!/usr/bin/env bash
# Gera src/integrations/supabase/types.ts a partir do banco local migrado (scripts/db-test.sh),
# usando o gerador oficial do Supabase (postgres-meta), sem Docker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${ROOT}/.cache/pgmeta"
PGPORT="${PGPORT:-54329}"
DB_NAME="${DB_NAME:-nexa_test}"

if [ ! -d "${CACHE}/node_modules/@supabase/postgres-meta" ]; then
  mkdir -p "${CACHE}"
  (cd "${CACHE}" && npm init -y >/dev/null && npm i --silent @supabase/postgres-meta@0.99.0 >/dev/null)
fi

PG_META_DB_URL="postgresql://postgres@localhost:${PGPORT}/${DB_NAME}" \
PG_META_GENERATE_TYPES=typescript \
PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public \
PG_META_POSTGREST_VERSION=14.5 \
  node "${CACHE}/node_modules/@supabase/postgres-meta/dist/server/server.js" \
  > "${ROOT}/src/integrations/supabase/types.ts" 2>/dev/null
npx prettier --write "${ROOT}/src/integrations/supabase/types.ts" >/dev/null
echo "Tipos gerados em src/integrations/supabase/types.ts"
