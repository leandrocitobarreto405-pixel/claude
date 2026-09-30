#!/usr/bin/env bash
# Teste ponta a ponta do webhook do Chatwoot: sobe o PostgREST local (no lugar do Supabase) e o
# servidor do app (vite dev) com a chave de serviço local, e envia eventos simulados.
set -euo pipefail

export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-54329}" PGUSER="${PGUSER:-postgres}"
export DB_NAME="${DB_NAME:-nexa_hook_test}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${ROOT}/.cache/postgrest"
VERSAO="v12.2.3"
PGRST_PORTA=3998
PROXY_PORTA=3997
APP_PORTA=3996
SEGREDO_JWT="segredo-de-teste-local-com-mais-de-32-caracteres"

DB_NAME="${DB_NAME}" "${ROOT}/scripts/db-test.sh" >/dev/null
PGOPTIONS="-c client_min_messages=warning" psql -q -X -v ON_ERROR_STOP=1 -d "${DB_NAME}" \
  -f "${ROOT}/supabase/tests/api/chatwoot-seed.sql"

if [ ! -x "${CACHE}/postgrest" ]; then
  mkdir -p "${CACHE}"
  curl -sSL "https://github.com/PostgREST/postgrest/releases/download/${VERSAO}/postgrest-${VERSAO}-linux-static-x64.tar.xz" \
    | tar -xJ -C "${CACHE}"
fi

TMP="$(mktemp -d)"
cat > "${TMP}/pgrst.conf" <<CFG
db-uri = "postgres://authenticator@localhost:${PGPORT}/${DB_NAME}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "${SEGREDO_JWT}"
server-port = ${PGRST_PORTA}
CFG

PIDS=()
APP_PGID=""
limpar() {
  [ -n "${APP_PGID}" ] && kill -- "-${APP_PGID}" 2>/dev/null
  kill "${PIDS[@]}" 2>/dev/null
  rm -rf "${TMP}"
}
trap limpar EXIT
"${CACHE}/postgrest" "${TMP}/pgrst.conf" > "${TMP}/pgrst.log" 2>&1 &
PIDS+=($!)

# O cliente do Supabase chama /rest/v1/...; o PostgREST puro responde na raiz.
# /storage/v1/object/<bucket>/<arquivo> serve arquivos de ${TMP}/storage (no lugar do Storage).
mkdir -p "${TMP}/storage"
STORAGE_DIR="${TMP}/storage" node -e '
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
http.createServer((req, res) => {
  if (req.url.startsWith("/storage/v1/object/")) {
    const rel = decodeURIComponent(req.url.slice("/storage/v1/object/".length).split("?")[0]);
    const arq = path.join(process.env.STORAGE_DIR, rel);
    if (!arq.startsWith(process.env.STORAGE_DIR + "/") || !fs.existsSync(arq)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" }));
    }
    res.writeHead(200, { "Content-Type": "video/mp4" });
    return fs.createReadStream(arq).pipe(res);
  }
  const p = http.request({ host: "127.0.0.1", port: '"${PGRST_PORTA}"', method: req.method,
    path: req.url.replace(/^\/rest\/v1/, ""), headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(p);
}).listen('"${PROXY_PORTA}"', "127.0.0.1");
' &
PIDS+=($!)

CHAVE_SERVICO="$(node -e '
const { createHmac } = require("node:crypto");
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const h = b({ alg: "HS256", typ: "JWT" }), p = b({ role: "service_role", exp: Math.floor(Date.now() / 1000) + 3600 });
console.log(`${h}.${p}.${createHmac("sha256", process.argv[1]).update(`${h}.${p}`).digest("base64url")}`);
' "${SEGREDO_JWT}")"
export NEXA_TAREFAS_SEGREDO="tarefa-de-teste-local-com-mais-de-32-caracteres"

# Claude e Chatwoot falsos para o teste da Alice.
export PORTA_CLAUDE=3995 PORTA_CHATWOOT=3994
node "${ROOT}/supabase/tests/api/alice-fakes.mjs" > "${TMP}/fakes.log" 2>&1 &
PIDS+=($!)

# setsid: o vite roda num grupo de processos próprio, encerrado inteiro no fim.
(cd "${ROOT}" && SUPABASE_URL="http://127.0.0.1:${PROXY_PORTA}" SUPABASE_SERVICE_ROLE_KEY="${CHAVE_SERVICO}" \
  ANTHROPIC_BASE_URL="http://127.0.0.1:${PORTA_CLAUDE}" ANTHROPIC_API_KEY="chave-de-teste-local" \
  GCE_METADATA_HOST="127.0.0.1:${PORTA_CHATWOOT}" SPEECH_API_URL="http://127.0.0.1:${PORTA_CHATWOOT}" \
  SHEETS_API_URL="http://127.0.0.1:${PORTA_CHATWOOT}" GOOGLE_OAUTH_TOKEN_URL="http://127.0.0.1:${PORTA_CHATWOOT}/oauth/token" \
  GOOGLE_CLIENT_ID="cliente-teste" GOOGLE_CLIENT_SECRET="segredo-teste" \
  exec setsid npx vite dev --host 127.0.0.1 --port "${APP_PORTA}" --strictPort > "${TMP}/app.log" 2>&1) &
APP_PGID=$!

for _ in $(seq 1 120); do
  curl -s -o /dev/null "http://127.0.0.1:${APP_PORTA}/" && break
  sleep 0.5
done

APP_URL="http://127.0.0.1:${APP_PORTA}" node "${ROOT}/supabase/tests/api/chatwoot-webhook.test.mjs" \
  || { echo "--- log do app ---"; tail -40 "${TMP}/app.log"; exit 1; }
APP_URL="http://127.0.0.1:${APP_PORTA}" STORAGE_DIR="${TMP}/storage" node "${ROOT}/supabase/tests/api/alice.test.mjs" \
  || { echo "--- log do app ---"; tail -60 "${TMP}/app.log"; exit 1; }
APP_URL="http://127.0.0.1:${APP_PORTA}" node "${ROOT}/supabase/tests/api/ads.test.mjs" \
  || { echo "--- log do app ---"; tail -60 "${TMP}/app.log"; exit 1; }
