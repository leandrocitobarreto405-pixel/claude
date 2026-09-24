# Quilometragem automática, status de despesas e despesas recorrentes

Tudo que já existe (OS, agenda, Google Docs, pagamentos, DRE, usuários, login) continua igual. As mudanças ficam em rotas/quilometragem, despesas e nos indicadores do início.

## O que descobri antes de planejar

- **Erro "não foi possível gerar despesas recorrentes"**: a função usa `upsert` com conflito em `recurring_expense_id, due_date`, mas **esse índice único não existe no banco** — o Postgres recusa a operação e nada é gerado. Vou criar o índice único e passar a gerar apenas o que falta.
- **Modelos recorrentes já existem** e conferem com a sua lista (Leandro/Maria/Carol/Josué, Marketing, Escritório virtual, WhatsApp verificado, Contabilidade, StayCloud, e Carro semanal na segunda-feira). Não vou duplicar; só completo o que faltar (dia de vencimento e beneficiário).
- **Rota do dia** já tem cálculo automático de trajeto (`calcularRotaDoDia` + `route-calc.server.ts`) e chave única por técnico + data — vou reaproveitar os dois, sem reescrever o cálculo.
- **Despesas hoje** não têm beneficiário, origem, valor pago parcial, rota relacionada nem histórico de status — isso entra por migração.
- **DRE** já usa data de competência (certo), mas o "caixa" soma valor previsto quando não há valor pago — vou corrigir para considerar somente o que foi realmente pago.
- **Não há job agendado hoje** (as extensões de agendamento estão desligadas) — vou ligar e criar o job mensal.

## 1. Banco de dados (uma migração)

- `expenses`: novos campos de beneficiário, origem (`Manual`, `Rota automática`, `Recorrente`), valor pago acumulado, rota relacionada, referência única (`reference_key`), exclusão suave e usuário da última alteração.
- Índice único em `expenses(recurring_expense_id, due_date)` e em `reference_key` — resolve o erro e garante zero duplicidade.
- `daily_routes`: status da rota (`Aguardando conclusão dos serviços`, `Calculando`, `Calculada`, `Aguardando custo por km`, `Custo gerado`, `Recalculada`, `Erro no cálculo`), origem do cálculo (automática/manual), endereço base usado, despesa relacionada, marca de "precisa recalcular" e de "diferença financeira após pagamento".
- Nova tabela `route_cost_allocations` (rota, OS, serviço, km rateado, custo rateado, método).
- Nova tabela `expense_status_history` (status anterior/novo, valores, quem alterou, quando, motivo).
- `recurring_expenses`: beneficiário e chave de semeadura estável.
- Semeadura: completa beneficiário/dia de vencimento dos 10 modelos existentes, sem criar duplicados.

## 2. Rota automática ao concluir o último serviço

- Ao marcar um serviço como **Concluído**, o sistema verifica em segundo plano se ainda existe serviço ativo (Agendado, Confirmado, Em deslocamento, Em execução, Reagendado) do mesmo técnico naquela data.
- Se ainda houver, a rota fica em "Aguardando conclusão dos serviços".
- Se todos estiverem concluídos: calcula (base do técnico → atendimentos na ordem dos horários → base), salva, rateia o custo entre as OSs concluídas (divisão igual, com preparo para "por trecho" e "proporcional à distância") e cria **uma** despesa de quilometragem do dia, sempre **Pendente**.
- Funciona com 1, 2, 3 ou mais serviços.
- Sem custo por km configurado: salva os km e marca "Aguardando custo por km" com o aviso "Rota calculada, mas o custo por km ainda não foi configurado."
- Endereço base sem número continua alertando.

### Sem duplicar

- Chave de idempotência `mileage:{tecnico}:{data}` na despesa e chave única técnico+data na rota: rodar duas vezes cria uma rota, uma despesa e um conjunto de rateios.
- Recalculou antes do pagamento: atualiza a despesa pendente e os rateios.
- Recalculou depois do pagamento: não altera nada em silêncio — mostra "A rota foi alterada após o pagamento da despesa.", com valor pago, novo valor, diferença e as ações **Criar ajuste financeiro**, **Manter valor pago** e **Reabrir despesa como pendente**.
- Serviço reaberto, cancelado, excluído, remarcado ou trocado de técnico: a rota é marcada para recálculo e recalcula sozinha quando o dia estiver concluído de novo; mudança de data tira o rateio da rota antiga e entra na nova.
- Se a automação falhar, o serviço concluído **não** é revertido: o erro é registrado, a rota fica "Erro no cálculo" e há retentativa manual.

### Página "Rotas e quilometragem"

Continua igual, agora como correção: recalcular, informar km real e motivo, alterar custo por km, ver rateio, sincronizar custo e abrir no mapa. Passa a mostrar o status da rota e a despesa vinculada.

## 3. Status das despesas nos dois sentidos

- Nova ação **Alterar status** em toda despesa, com Pendente, Parcialmente pago, Pago, Vencido e Cancelado.
- Pendente → Pago: pede valor pago (sugere o previsto), data, forma de pagamento e observação.
- Pago → Pendente: confirma com "Esta despesa está marcada como paga. Deseja reabri-la como pendente?"; limpa data e valor pago atuais, volta a Pendente, atualiza o caixa e **guarda o pagamento anterior no histórico**.
- Parcialmente pago: previsto, pago, restante (previsto − pago) e data do último pagamento; impede pago maior que o previsto sem confirmação de ajuste.
- Cada mudança grava histórico, visível no detalhe da despesa.

## 4. Despesas recorrentes

- Geração corrigida: cria só o que falta, nunca mexe em despesa paga, sempre **Pendente**. Resumo no final: "10 despesas verificadas. 2 despesas criadas e 8 já existentes."
- Geração automática: job mensal (dia 1, após 00:05, horário de São Paulo) chamando um endpoint interno; além disso, ao abrir o mês, o app detecta mês não sincronizado e gera sozinho — recuperação caso o job falhe.
- Carro: uma despesa por segunda-feira do mês (5 segundas = 5 despesas), nunca somadas em uma só.
- Sem dia de vencimento configurado: a despesa aparece como pendente do mês com o aviso "Dia de vencimento não configurado".
- Nova seção **Despesas recorrentes do mês** em Custos e despesas: previstas, geradas, faltantes, pagas, pendentes e os totais, com o botão **Sincronizar despesas do mês**.
- Nova área **Despesas recorrentes** (em Configurações) para criar, editar nome/valor/categoria/recorrência/dia, ativar, desativar, definir início e fim e ver os lançamentos gerados. Ao editar, pergunta: somente neste lançamento, a partir do próximo, ou todos os futuros. Lançamentos pagos antigos nunca mudam sozinhos.

## 5. Página Custos e despesas

Filtros: Todas, Pendentes, Pagas, Parcialmente pagas, Vencidas, Recorrentes, Quilometragem, Canceladas. Colunas: descrição, categoria, beneficiário, origem, competência, vencimento, previsto, pago, restante, status, data do pagamento, OS/rota relacionada e última atualização. Ações: registrar pagamento, alterar status, editar, cancelar, ver histórico e abrir rota.

## 6. DRE e caixa

- DRE por **competência**: despesa válida entra no mês dela mesmo pendente (salário de agosto no DRE de agosto, cada segunda do carro no seu mês). Canceladas e excluídas ficam fora.
- Caixa somente pelo que foi **pago**: pendente R$ 0,00, parcialmente pago só a parte paga, pago o valor integral, cancelado nada. Reabrir uma despesa tira o valor do caixa e mantém o histórico.

## 7. Indicadores no início

Rotas aguardando conclusão, rotas aguardando custo por km, rotas com erro, despesas recorrentes não geradas, despesas pendentes, despesas vencidas e quilometragem pendente de pagamento — cada um com link para a página.

## 8. Mensagens e auditoria

Todas as mensagens em português, incluindo as do enunciado ("Não foi possível calcular a rota automaticamente.", "Já existe uma despesa de quilometragem para este técnico e esta data." etc.). Auditoria registra quem alterou, quem pagou, quem reabriu, quando a rota foi calculada, a origem (automática/manual) e valores antigos e novos. Despesas já referenciadas por DRE, caixa, rotas ou pagamentos usam exclusão suave.

## Parte técnica

- Migração única com as tabelas/colunas/índices acima + semeadura idempotente dos modelos recorrentes.
- `src/lib/routes.functions.ts` + novo `src/lib/route-auto.server.ts`: função de servidor `sincronizarRotaDoDia({date, technicianId})` que verifica conclusão, calcula (reusa `calculateDayRoute`), grava `daily_routes`, `route_cost_allocations`, `visits.mileage_cost_allocated` e a despesa com `reference_key`.
- `completeVisit` em `src/lib/os.ts` dispara `sincronizarRotaDoDia` sem bloquear a conclusão (erro só registra e marca a rota).
- `src/lib/expenses.ts` (novo): alterar status, pagamento parcial, reabertura, histórico.
- `src/lib/recurring.functions.ts` (novo): `sincronizarDespesasDoMes` com contagem de criadas/existentes; usada pela página, pelo autodetector de mês e pelo job.
- `src/routes/api/public/hooks/recurring-expenses.ts` + habilitar `pg_cron`/`pg_net` e agendar dia 1 às 00:05 (São Paulo).
- Telas: `despesas.tsx` (abas, colunas, diálogos de status/histórico), `configuracoes.tsx` (aba Despesas recorrentes), `rotas.tsx` (status da rota, rateio, conflito pós-pagamento), `inicio.tsx` (pendências), `reports.ts` (competência x caixa).
