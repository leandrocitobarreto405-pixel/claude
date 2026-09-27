#!/usr/bin/env bash
# Sobe (ou cria) o Postgres local usado por test:db e test:api, em /tmp:54329.
# Uso: scripts/pg-local.sh
set -euo pipefail

PORTA="${PGPORT:-54329}"
DADOS="${PG_LOCAL_DIR:-/var/lib/postgresql/nexa}"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[ -n "${BIN}" ] || { echo "Postgres não encontrado em /usr/lib/postgresql"; exit 1; }

if pg_isready -h /tmp -p "${PORTA}" >/dev/null 2>&1; then
  echo "Postgres local já está no ar (porta ${PORTA})."
  exit 0
fi

como_postgres() {
  if [ "$(id -u)" = "0" ]; then su postgres -c "$*"; else bash -c "$*"; fi
}

if [ ! -f "${DADOS}/PG_VERSION" ]; then
  mkdir -p "${DADOS}"
  [ "$(id -u)" = "0" ] && chown postgres "${DADOS}"
  como_postgres "${BIN}/initdb -D ${DADOS} -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
fi
rm -f "${DADOS}/postmaster.pid"
como_postgres "${BIN}/pg_ctl -D ${DADOS} -l ${DADOS}.log -o '-p ${PORTA} -k /tmp' -w start" >/dev/null
echo "Postgres local no ar (porta ${PORTA})."
