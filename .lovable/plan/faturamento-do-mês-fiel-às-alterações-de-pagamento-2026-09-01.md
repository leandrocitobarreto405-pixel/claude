# Faturamento do mês fiel às alterações de pagamento

## O que está acontecendo hoje

- O "faturamento do mês" da tela inicial soma o **valor dos atendimentos concluídos no mês** (competência). Reabrir um pagamento não muda esse número, e alterar o valor total da OS também não, porque o total da OS não é repassado para o atendimento.
- Exemplo real: a OS 1543 está com total R$ 2.514,74, mas os atendimentos somam R$ 799,14 + R$ 0,00.
- Existem 6 atendimentos concluídos com valor final R$ 0,00 mesmo tendo valor de visita — inclusive OS 1543 (R$ 1.810,50 pago) e OS 1423 (R$ 2.022,87). Eles entram como zero no faturamento.
- Nenhuma tela avisa o resumo do mês quando um pagamento ou uma OS muda, então a tela inicial pode seguir exibindo o número anterior.

## O que vai mudar

### 1. Faturamento passa a ser o valor recebido

A "Meta de faturamento do mês" e o percentual da meta passam a usar o **valor efetivamente recebido no mês** (pagamentos ativos com data de pagamento no mês). Consequências diretas:

- Reabrir um pagamento tira o valor do faturamento na hora.
- Registrar o pagamento de novo (com outra forma/valor) soma o novo valor.
- O DRE continua por competência (receita de serviços realizados), com o caixa em bloco separado — nada muda lá.

O card "Valor recebido no mês" deixa de duplicar a informação e passa a mostrar o recebido líquido (descontadas as taxas), para não repetir o mesmo número da meta.

### 2. Alterar o valor da OS ajusta o atendimento concluído

Ao salvar uma OS com novo valor total, o sistema atualiza o valor final dos atendimentos concluídos para refletir o total negociado (rateando quando há mais de um atendimento), registra o motivo no histórico da OS e recalcula comissão prevista/realizada. Assim o valor a receber e o DRE acompanham a alteração.

### 3. Corrigir os atendimentos com valor final zerado

- Regra nova: valor final igual a zero em atendimento concluído com valor de visita maior que zero passa a ser tratado como "não informado" e usa o valor da visita.
- Correção dos 6 registros existentes, ajustando o valor final para o valor da visita (ou para o valor pago, quando houver pagamento maior).

### 4. Números que se atualizam sozinhos

Depois de reabrir/registrar pagamento, concluir atendimento, editar ou cancelar OS e lançar despesa, o app invalida o resumo do mês, o "A receber", a agenda e os pagamentos — a tela inicial já abre com o número certo, sem precisar recarregar.

## Detalhes técnicos

- `src/lib/reports.ts`: `received` continua vindo de `fetchPayments` (ativos, `payment_date` no mês); adicionar `receivedNet`; expor `revenue` (competência) apenas para o DRE. Aplicar o fallback `final_value > 0 ? final_value : visit_value` no cálculo de receita, comissões e rateios.
- `src/routes/_authenticated/inicio.tsx`: `realizado = resumo.received`; card "Valor recebido no mês" usa `receivedNet` com dica de taxas.
- `src/lib/receivables.ts`: mesmo fallback de valor efetivo.
- `src/lib/os.ts` (`updateWorkOrder`/recalculo de totais): ao mudar `total_gross_value`, distribuir a diferença nos atendimentos concluídos (`final_value`, `value_change_reason`), gravar evento no histórico e recalcular `commission_expected`/`commission_realized`.
- Invalidação de cache: introduzir chaves compartilhadas e trocar os `query.refetch()` locais por `queryClient.invalidateQueries` em `payment-dialog.tsx`, `pagamentos.tsx`, `visit-dialog.tsx`, `agenda.tsx`, `os.$osNumber.tsx`, `despesas.tsx` e `a-receber.tsx` (chaves `month_summary`, `receivables`, `payments`, `visits`, `expenses`).
- Correção de dados: atualização pontual dos 6 atendimentos concluídos com `final_value = 0` (sem alteração de schema).
