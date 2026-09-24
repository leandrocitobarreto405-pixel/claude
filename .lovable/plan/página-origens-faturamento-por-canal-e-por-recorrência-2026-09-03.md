# Página "Origens" — faturamento por canal e por recorrência

## Objetivo
Responder, em um só lugar: no mês, quantos clientes e quanto de faturamento vieram do Google (e das demais origens), e quanto veio de cliente que já era cliente.

## O que será criado

Nova página **Origens** no menu Financeiro (`/origens`), com filtro de período (dia, semana, mês, personalizado — mesmo padrão da página de Pagamentos).

### Bloco 1 — Por origem da venda
Tabela com uma linha por origem (Google, Facebook, Instagram, Indicação, Cliente recorrente, Indefinida) e colunas:
- Clientes atendidos (distintos)
- Serviços concluídos
- Faturamento realizado
- Ticket médio por cliente
- % do faturamento do período

Cartões de destaque no topo com Google e o total do período.

### Bloco 2 — Novo x recorrente (histórico real)
Duas linhas — "Cliente novo" e "Cliente recorrente" — com clientes, serviços, faturamento e ticket médio.
Regra: um serviço conta como recorrente quando aquele cliente já tinha uma OS anterior (data de venda anterior à OS do serviço), independentemente da origem marcada.

### Bloco 3 — Cruzamento
Tabela origem x (novo / recorrente), mostrando o faturamento em cada cruzamento. Ex.: quanto do faturamento do Google veio de cliente que já era cliente.

Cada tabela terá botão de exportar CSV do período, seguindo o padrão já usado em Exportações.

## Base de cálculo
- Faturamento = valor efetivo dos atendimentos **concluídos** no período (mesma regra já usada no DRE em "Receita por origem da venda"), aplicando descontos/abatimentos existentes.
- Origem vem da OS (`sales_origin`); OS sem origem aparece como "Indefinida".
- Visitas de orçamento não entram como faturamento; podem entrar depois se você quiser medir conversão.

## Detalhes técnicos
- Nova rota `src/routes/_authenticated/origens.tsx` com `head()` próprio.
- Novo hook em `src/lib/reports.ts` (ex.: `useOriginBreakdown(from, to)`) reutilizando `fetchCompletedVisits` e `effectiveVisitValue`, mais uma consulta em `work_orders` (customer_id, sale_date) para classificar novo/recorrente por histórico.
- Item de menu em `src/components/app-shell.tsx`, seção Financeiro.
- Sem alteração de banco de dados.

## Como saber que deu certo
- Selecionando o mês atual, a soma do faturamento por origem bate com a receita realizada do DRE no mesmo mês.
- Google e Cliente recorrente aparecem com clientes, serviços e faturamento distintos, e o cruzamento mostra quanto do Google é recompra.
