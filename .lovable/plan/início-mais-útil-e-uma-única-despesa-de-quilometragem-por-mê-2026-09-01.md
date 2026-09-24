# Início mais útil e uma única despesa de quilometragem por mês

## 1. "A receber" está errado — e agora vai ser clicável

Conferi no banco: hoje o cartão soma **o valor total de todas as OS de todos os tempos** (inclusive OS excluídas) e desconta todos os pagamentos já feitos. É exatamente daí que sai R$ 5.696,35 — dentro disso entram OS excluídas e diferenças de centavos de OS antigas, nada a ver com serviços a receber.

Passa a ser: **serviços agendados ainda não pagos + serviços já concluídos ainda não pagos**, sem OS canceladas nem excluídas.

- O cartão mostra o total e, abaixo, a quebra: "Agendados R$ X · Concluídos R$ Y".
- Clicar no cartão abre a nova página **A receber**, com duas abas (Agendados / Concluídos), listando OS, cliente, data do serviço, técnico, valor do serviço, valor já pago e o saldo. Cada linha leva à OS.

## 2. Pendências que levam ao lugar certo

Cada pendência passa a abrir a página já filtrada:

- **Serviços atrasados sem conclusão** → Agenda no modo "Atrasados": lista só os serviços com data anterior a hoje e status Agendado, Confirmado, Em execução ou Reagendado (o mesmo critério do número mostrado no início).
- **Serviços sem técnico definido** → Agenda no modo "Sem técnico".
- **OS com pagamento pendente** → Pagamentos já com o status "Não pago" selecionado.
- **Despesas vencidas / pendentes do mês** → Despesas na aba correspondente.
- **Rotas pendentes de cálculo / alteradas após o pagamento** → Rotas com o filtro correspondente.

Para isso a Agenda ganha dois modos extras ("Atrasados" e "Sem técnico") que ignoram o período e olham todos os serviços em aberto, e passa a aceitar filtro pela URL.

## 3. Uma despesa só de quilometragem, por mês e por técnico

O fechamento diário sai de cena. No lugar:

- **Automático**: no dia 1º de cada mês, o sistema calcula as rotas de todos os dias do mês anterior, técnico por técnico, e cria **uma única despesa** por técnico — "Quilometragem Josué — agosto/2026" — com competência no último dia do mês, valor = total de km do mês × custo por km e as observações detalhando dia a dia (data, km, valor). Sempre **Pendente**, para você dar baixa de uma vez.
- **Manual**: botão **Fechar quilometragem do mês** na página Rotas, com seletor de mês e técnico, para gerar ou atualizar o consolidado quando quiser (inclusive do mês corrente, antes do dia 1º).
- **Sem duplicar**: a despesa é identificada por técnico + mês; rodar de novo atualiza o valor e o detalhamento em vez de criar outra. Se ela já estiver paga, o valor pago é preservado e a rota é sinalizada como "alterada após o pagamento", como já acontece hoje.
- **Consolidação do que já existe**: as despesas diárias de quilometragem **pendentes** são canceladas e entram no consolidado do mês; as que já foram **pagas** ficam intactas e são descontadas do valor consolidado, para não pagar duas vezes.
- O rateio por serviço (custo dentro de cada atendimento) continua igual — ele serve ao DRE e não gera despesa própria.
- A página Rotas continua igual para conferir, recalcular e informar km real de um dia específico; ela passa a mostrar de qual fechamento mensal aquele dia faz parte.

## 4. O que não muda

Meta do mês, serviços de hoje/amanhã, DRE, pagamentos, CRM, OS e documentos continuam como estão.

## Parte técnica

- `src/lib/reports.ts`: substituir o cálculo de `receivable` (hoje `total de work_orders − todos os pagamentos`) por consulta a `visits` (status agendados vs. `Concluído`), agrupada por OS, descontando `payments` ativos da OS e excluindo OS `Cancelada`/`deleted_at`. Expor `receivableScheduled`, `receivableCompleted` e a lista de itens.
- Nova rota `src/routes/_authenticated/a-receber.tsx` com as duas abas, reusando o novo hook.
- `src/routes/_authenticated/agenda.tsx`: `validateSearch` com `modo`, `status`, `tecnico`; modos "atrasados" e "sem-tecnico" trocam a consulta por período pela consulta de pendências.
- `src/routes/_authenticated/pagamentos.tsx` e `despesas.tsx`: aceitar filtro inicial via `validateSearch`.
- `src/routes/_authenticated/inicio.tsx`: cartão "A receber" com link e quebra; `Pend` passando `search`.
- `src/lib/route-auto.server.ts`: nova função `closeMonthlyMileage(db, { month, technicianId? })` que percorre os dias do mês, chama `syncDailyRoute` sem criar despesa diária, soma km/custo e grava a despesa consolidada com `reference_key = mileage:{tecnico}:{AAAA-MM}`; `syncDailyRoute` ganha a opção `createExpense: false` (padrão) e passa a apenas calcular rota + rateio. Migração leve não é necessária (usa colunas existentes).
- Novo endpoint `src/routes/api/public/hooks/monthly-mileage-closing.ts` e novo job `pg_cron` no dia 1º às 00:20 (São Paulo); desativar o job `fechamento-rotas-diario` e remover `src/routes/api/public/hooks/daily-route-closing.ts`.
- Consolidação de histórico: as despesas de quilometragem diárias pendentes recebem `status = 'Cancelado'` com nota de consolidação; as pagas são somadas como crédito no consolidado do mês correspondente.
- `src/lib/routes.functions.ts`: server fn `fecharQuilometragemDoMes` usada pelo botão em Rotas.
