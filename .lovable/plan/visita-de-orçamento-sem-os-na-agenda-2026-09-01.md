# Visita de orçamento (sem OS) na agenda

Permitir agendar uma visita técnica de orçamento sem abrir OS, com o deslocamento entrando na rota do técnico e botão para gerar a OS depois.

## Como vai funcionar

- Nova ação **"Nova visita de orçamento"** (na Agenda e no menu de criação): escolher cliente já cadastrado (ou cadastrar na hora, com busca por CEP como hoje), data, hora, técnico, descrição do estofado a orçar, taxa de visita (opcional) e observações.
- A visita aparece na Agenda junto com os atendimentos normais, com selo **"Orçamento"** para diferenciar visualmente.
- Status próprios: Agendado, Confirmado, Em deslocamento, Realizado, Reagendado, Cancelado.
- Ao abrir a visita de orçamento: editar dados, concluir informando o **resultado** (Orçamento aprovado / Recusado / Cliente vai avaliar / Não foi possível orçar), motivo e observações.
- Se aprovado, botão **"Gerar OS deste orçamento"** abre a Nova OS já com o cliente, origem da venda e descrição preenchidos; a visita passa a mostrar o link para a OS criada.
- Taxa de visita: se informada, entra em pagamentos/a receber como qualquer serviço cobrado; se zero, nunca aparece em faturamento.

## Deslocamento

- A visita de orçamento passa a ser uma **parada da rota do dia** do técnico: entra no cálculo automático de quilometragem (diário às 23:59 e no fechamento mensal), no rateio de custo e na despesa de combustível — mesma lógica dos atendimentos, sem despesa extra separada.
- Na tela de Rotas a parada aparece identificada como "Orçamento — {cliente}" e o custo rateado fica visível na visita.
- Visitas de orçamento canceladas não entram na rota.

## Onde aparece

- Agenda (dia/semana/mês, atrasados, sem técnico): incluída nas listas e nos filtros de técnico e status.
- Rotas: como parada e no rateio.
- Cliente/CRM: histórico do cliente mostra a visita de orçamento e a OS gerada, quando houver.
- Início: as visitas de orçamento pendentes contam nas pendências de agenda, sem afetar faturamento.

## Detalhes técnicos

**Banco** — nova tabela `public.budget_visits` (com GRANTs para `authenticated`/`service_role`, RLS por staff igual às demais):

- `customer_id` (obrigatório, FK `customers`), `technician_id` (FK `technicians`)
- `scheduled_date`, `scheduled_time`, `status` (default `Agendado`)
- `upholstery_description`, `notes`
- `visit_fee numeric not null default 0`
- `result`, `result_notes`, `completed_at`
- `generated_work_order_id` (FK `work_orders`, nulo até gerar a OS)
- `crm_lead_id` nulo por ora (reservado), `sales_origin_id` (FK `config_options`)
- `mileage_cost_allocated numeric not null default 0`
- trigger `update_updated_at_column`

`route_cost_allocations` recebe coluna opcional `budget_visit_id` (FK) para o rateio da parada de orçamento.

**Código**

- `src/lib/budget-visits.ts`: tipos, `BUDGET_VISIT_SELECT`, CRUD, conclusão com resultado e vínculo com OS gerada.
- `src/lib/route-calc.server.ts` / `route-auto.server.ts`: buscar também `budget_visits` do dia e unir as paradas por horário, usando as coordenadas do cliente (mesmo geocode em cascata e cache já existentes); rateio grava `budget_visit_id`.
- `src/routes/_authenticated/agenda.tsx`: consulta combinada (atendimentos + orçamentos) normalizada num tipo comum de item de agenda, com badge "Orçamento".
- Novo `src/components/budget-visit-dialog.tsx` para criar/editar/concluir, no padrão do `visit-dialog.tsx` (usando `NativeSelect`).
- Geração de OS: navega para `/nova-os` com o cliente pré-selecionado e, ao salvar, grava `generated_work_order_id` na visita de orçamento.
- Taxa de visita cobrada usa `createPayment` já existente, vinculada à OS gerada quando houver; sem OS, fica registrada como taxa da visita e listada em a receber.
- `supabase--get_types` após a migração; cache invalidada via `invalidateFinanceQueries` + chave `agenda`.

## Verificação

Criar uma visita de orçamento para amanhã com técnico definido, conferir que aparece na Agenda com selo, que a rota do dia inclui a parada e rateia o custo, concluir como aprovado e gerar a OS a partir dela.
