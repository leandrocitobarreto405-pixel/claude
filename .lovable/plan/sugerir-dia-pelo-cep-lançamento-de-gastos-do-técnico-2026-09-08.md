# Sugerir dia pelo CEP + lançamento de gastos do técnico

## Parte 1 — Sugerir o melhor dia pelo CEP

Na página **Agenda**, um bloco novo: **"Sugerir dia pelo CEP"**.

1. Você digita o CEP do cliente (só o CEP).
2. O app mostra o endereço encontrado para você confirmar a região.
3. Clica em "Sugerir dias".
4. Ele olha os atendimentos já agendados nos **próximos 30 dias** e devolve os **3 dias mais próximos** daquele CEP, em ordem de distância.

Cada sugestão mostra:

- data e dia da semana;
- distância até o atendimento mais próximo daquele dia (ex.: "2,4 km de Maria Silva, Pirituba");
- quantos atendimentos já existem no dia, com o horário do primeiro e do último;
- o técnico do dia.

Regras:

- Conta atendimentos de OS e visitas de orçamento, ignorando cancelados.
- Só de hoje em diante, dentro de 30 dias.
- Sem limite de distância: sempre lista os 3 melhores dias, mostrando a distância para você decidir.
- Endereço de cliente que não for localizado no mapa é ignorado, com aviso discreto.
- Sem nada agendado no período, mostra "nenhum atendimento agendado nesse período".

## Parte 2 — Técnico lança gastos do dia (estacionamento, pedágio, zona azul)

Nova página **"Lançar gastos"** no menu, simples e pensada para o celular:

1. O técnico escolhe a **data** (já vem o dia de hoje).
2. Marca um ou mais tipos: **Estacionamento**, **Pedágio**, **Zona azul** (pode marcar mais de um).
3. Informa o **valor total** do lançamento.
4. Seleciona a **OS** em que estava trabalhando (lista das OSs com atendimento naquele dia; também aceita buscar por número/cliente). Pode marcar "sem OS" quando não houver.
5. Observação opcional.
6. Salva. Abaixo aparece a lista dos lançamentos do mês, com o total, e ele pode corrigir ou excluir enquanto o mês não estiver fechado.

Como isso vira dinheiro a pagar:

- Cada lançamento **não** cria uma despesa separada.
- No fim do mês, todos os lançamentos do técnico viram **uma única despesa pendente**, no dia 31 (ou último dia do mês), com a descrição "Gastos de deslocamento — {técnico} — {mês}" e o valor somado. Ex.: R$10 hoje + R$10 amanhã + R$10 depois = **uma despesa de R$30**.
- Essa despesa é recalculada automaticamente quando um lançamento é incluído/corrigido no mês corrente, e entra no DRE do mês de competência como as outras despesas (só soma no DRE o que foi efetivamente pago).
- Fica junto do fechamento mensal de quilometragem, que já existe, então o fechamento do mês gera as duas coisas de uma vez.

## Parte técnica

### Sugestão por CEP

- Nova server function `sugerirDiasPorCep` em `src/lib/routes.functions.ts` (com `requireSupabaseAuth`, entrada `{ cep }` validada).
- Novo `src/lib/route-suggest.server.ts`:
  - localiza o CEP com `geocodeParts({ postal_code })` de `geo.server.ts` (cascata e validação de CEP já existentes);
  - busca `visits` (join `work_orders`→`customers`) e `budget_visits` de hoje a hoje+30, `status != 'Cancelado'`, reusando os SELECTs de `route-calc.server.ts`;
  - usa `customers.latitude/longitude` em cache, geocodifica só o que falta e grava no cadastro (respeitando o throttle de 1,1 s);
  - agrupa por data, calcula distância em linha reta (Haversine), guarda a menor por dia, ordena e retorna os 3 primeiros com `{ date, km, nearest, stops, firstTime, lastTime, technicianName }` e `failures[]`.
- Linha reta (sem OSRM) para resposta rápida; OSRM segue só no fechamento de rota.
- UI em `src/routes/_authenticated/agenda.tsx` com `useServerFn` + `useMutation` e feedback via `sonner`.

### Gastos do técnico

- Migração: nova tabela `public.technician_expenses`
  - `id`, `technician_id` (FK), `expense_date date`, `categories text[]` (valores `Estacionamento`/`Pedágio`/`Zona azul`), `amount numeric not null`, `work_order_id` (FK, nullável), `notes text`, `expense_id` (FK `expenses`, preenchido no fechamento), `created_by`, `created_at`, `updated_at` + trigger `update_updated_at_column`.
  - GRANT `SELECT, INSERT, UPDATE, DELETE` para `authenticated` e `ALL` para `service_role`; RLS habilitada com políticas por `is_staff(auth.uid())`, no mesmo padrão das outras tabelas.
- `src/lib/technician-expenses.ts`: queries/mutations do CRUD e hook de lista mensal com total.
- Nova rota `src/routes/_authenticated/gastos-tecnico.tsx` (formulário mobile-first, `MoneyInput` para o valor, `NativeSelect` para técnico/OS) + item de menu em `src/components/app-shell.tsx`.
- Consolidação mensal em `src/lib/route-auto.server.ts` (junto de `closeMonthlyMileage`): soma os lançamentos do mês por técnico e cria/atualiza uma despesa `origin` própria, categoria "Deslocamento", `competence_date` no último dia do mês, `due_date` igual, `status = 'Pendente'`, com `reference_key` estável (`tech-expenses:{technicianId}:{yyyy-mm}`) para idempotência; grava `expense_id` nos lançamentos incluídos.
- Recalcular também ao salvar/editar/excluir um lançamento do mês corrente, e invalidar as queries de despesas/DRE pelo helper de finanças já existente.
