#!/usr/bin/env bash
# Criação simultânea de orçamentos: 8 conexões criando 25 orçamentos cada, ao mesmo tempo, na
# mesma empresa. Nenhum número pode repetir nem faltar, e o contador termina no total. Dados
# fictícios (empresa criada e removida só para o teste, no banco local).
set -euo pipefail
run() { PGOPTIONS="-c client_min_messages=warning" psql -q -X -v ON_ERROR_STOP=1 -d "${DB_NAME}" "$@"; }
EMP='48000000-0000-0000-0000-0000000000cc'
# Limpa no fim (mesmo com falha): o banco local é reaproveitado pelos testes da API.
limpar() {
  run -c "DELETE FROM public.quotes WHERE empresa_id = '${EMP}';
          DELETE FROM public.orcamento_contadores WHERE empresa_id = '${EMP}';
          DELETE FROM public.empresas WHERE id = '${EMP}';" || true
}
trap limpar EXIT
run -c "INSERT INTO public.empresas (id, nome) VALUES ('${EMP}', 'Concorrência Fictícia') ON CONFLICT DO NOTHING"
for s in $(seq 1 8); do
  run -c "DO \$\$ BEGIN FOR i IN 1..25 LOOP
            INSERT INTO public.quotes (empresa_id, cliente_nome, status) VALUES ('${EMP}', 'Simultâneo ${s}-' || i, 'rascunho');
          END LOOP; END \$\$" &
done
wait
RES=$(run -At -c "SELECT count(*), count(DISTINCT numero), min(numero), max(numero),
                     (SELECT ultimo FROM public.orcamento_contadores WHERE empresa_id = '${EMP}')
                    FROM public.quotes WHERE empresa_id = '${EMP}'")
echo "orçamentos|distintos|min|max|contador = ${RES}"
[ "${RES}" = "200|200|1|200|200" ] || { echo "FALHOU: numeração simultânea"; exit 1; }
