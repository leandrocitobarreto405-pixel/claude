# Pagamentos com filtro por período, soma no final e faturamento fiel

## O que encontrei

- A página de Pagamentos hoje só filtra por **mês** (e usa o dia 31 como fim, o que quebra meses curtos). As somas aparecem apenas em cards no topo, não no fim da lista.
- O faturamento do mês soma **todos os pagamentos ativos**, inclusive os que não estão com status "Pago". Existe 1 pagamento ativo com status "Cancelado" (R$ 0,01) entrando na conta.
- Encontrei uma provável **duplicidade** que explica o valor "diferente": a OS 1513 tem dois pagamentos idênticos de R$ 316,00 em 30/08 (total R$ 632,00), enquanto o atendimento concluído vale R$ 316,00. Isso infla o faturamento em R$ 316,00.

## O que vai mudar

### 1. Filtro por mês, semana ou dia

Na página Pagamentos, um seletor de período: **Dia**, **Semana**, **Mês** e **Personalizado** (de/até). O título e os totais acompanham o período escolhido. O fim do mês passa a ser o último dia real do mês.

### 2. Soma automática no final da lista

A tabela ganha um rodapé fixo com os totais do que está filtrado: **quantidade de pagamentos, total bruto, total de taxas e total líquido** (somando só os pagamentos ativos e pagos). Os cards do topo continuam, refletindo o mesmo período.

### 3. Faturamento fiel ao recebido

- Só entram no faturamento os pagamentos **ativos e com status "Pago"** — pagamentos pendentes, cancelados ou reabertos ficam de fora.
- A regra de competência continua a mesma: o valor conta no mês em que o serviço foi concluído.

### 4. Duplicidade de pagamento

- Quando dois pagamentos ativos da mesma OS tiverem mesmo valor e mesma data, a linha recebe um selo **"Possível duplicidade"** com aviso, para você reabrir/cancelar o que não vale.
- Não vou apagar nada automaticamente: o caso da OS 1513 (dois lançamentos de R$ 316,00) fica sinalizado para você confirmar e cancelar um deles em um clique.

## Detalhes técnicos

- `src/routes/_authenticated/pagamentos.tsx`: estado de período (`modo` + data base) gerando `from`/`to`; helpers de início/fim de dia, semana (seg–dom) e mês em `src/lib/format.ts`; `queryKey: ["pagamentos", from, to]`; rodapé `<tfoot>` com os totais; detecção de duplicidade por chave `work_order_id|payment_date|gross_amount` entre ativos.
- `src/lib/reports.ts`: em `fetchPaymentsByServiceMonth`, filtrar também `payment_status = "Pago"`, mantendo `is_active = true` e a regra de competência por conclusão do atendimento; `received`, `receivedNet`, `fees` e `feesByChannel` passam a refletir só pagos.
- Sem alteração de schema e sem correção automática de dados.
