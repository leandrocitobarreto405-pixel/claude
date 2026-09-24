# Quilometragem automática e combustível do técnico

Hoje a página "Rotas e quilometragem" exige que você digite a quilometragem do dia à mão. O plano é o sistema calcular sozinho, a partir dos endereços dos atendimentos agendados, e já mostrar quanto pagar de combustível ao técnico.

## Como vai funcionar

1. Você escolhe o dia e o técnico.
2. Clica em "Calcular quilometragem automaticamente".
3. O sistema monta o trajeto: casa do técnico → serviço 1 → serviço 2 → ... → último serviço do dia (sem a volta para casa).
4. Ele mostra a distância total em km, a distância de cada trecho e o tempo estimado.
5. O valor a pagar ao técnico é km × R$ 0,57 (valor editável nas Configurações).
6. Você pode ajustar o número à mão se a realidade foi diferente, informando o motivo — o valor automático fica guardado para comparação.
7. Ao salvar, o custo continua sendo rateado entre os serviços do dia, como já é hoje.

## Detalhes

- Endereço base do técnico Josué já passa a ser: Rua Mercedes Baravelle Fraga, 238 — CEP 02837-100, São Paulo/SP. Continua editável em Configurações > Equipe.
- Ordem das paradas: a sequência dos horários agendados (não é otimizada).
- Se algum endereço não for encontrado no mapa, a página avisa qual cliente precisa ter o endereço corrigido e calcula o restante.
- O custo por km padrão passa de R$ 1,50 para R$ 0,57.

## Parte técnica

- Nova server function `src/lib/routes.functions.ts`:
  - Geocodifica endereços via Nominatim (OpenStreetMap, gratuito, com `User-Agent` próprio e cache).
  - Calcula a distância rodoviária via OSRM público (`/route/v1/driving/...`), trecho a trecho, na ordem dos horários.
  - Retorna `{ trechos: [{de, para, km, minutos}], totalKm, totalMinutos, falhas: [] }`.
- Cache das coordenadas nas colunas `customers.latitude` / `customers.longitude` (já existem) e em `technicians` via novas colunas `base_latitude` / `base_longitude` (migração pequena), evitando geocodificar de novo a cada cálculo.
- `daily_routes` guarda `calculated_km` (automático), `real_km` (ajuste manual), `segments` com os trechos, `cost_per_km` e `total_cost` — colunas já existentes.
- `src/routes/_authenticated/rotas.tsx`: botão de cálculo, tabela de trechos, cartão "Combustível a pagar ao técnico", campo de ajuste manual com motivo.
- Configurações > Meta e custos: custo por km atualizado para 0,57 como padrão.
