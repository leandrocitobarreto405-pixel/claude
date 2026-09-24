# Faturamento no mês em que o serviço foi feito

## O que está acontecendo

O faturamento do mês usa a **data do pagamento**. Confirmei o caso que você citou: o pagamento de R$ 704,24 tem data 01/09, mas o atendimento da OS 1543 foi concluído em 31/08. Por isso o valor entrou em setembro em vez de agosto.

## O que vai mudar

### 1. O recebimento passa a contar no mês do serviço

Cada pagamento é atribuído ao mês em que o atendimento foi **concluído**:

- pagamento ligado a um atendimento → mês da conclusão desse atendimento;
- pagamento sem atendimento vinculado → mês da conclusão do atendimento mais recente da OS;
- se a OS não tem nenhum atendimento concluído → continua valendo a data do pagamento.

Isso vale mesmo que o mês já tenha "fechado": receber hoje um serviço de agosto aumenta o faturamento de agosto, não o de setembro.

### 2. Onde isso aparece

- Meta e faturamento do mês na tela inicial (bruto e líquido, com as taxas).
- Bloco "Visão de caixa" do DRE: passa a chamar o valor de "Recebimentos de serviços do mês" para deixar claro o critério.
- A receber e histórico de pagamentos continuam mostrando a data real do pagamento — o critério novo é só para somar o faturamento do mês.

### 3. Correção imediata do caso atual

Nada a corrigir manualmente: com a nova regra, os R$ 704,24 saem de setembro e passam a somar em agosto automaticamente, sem alterar a data do pagamento (que continua 01/09, correta para o caixa).

## Detalhes técnicos

- `src/lib/reports.ts`: nova busca de pagamentos por competência de serviço, no lugar do filtro por `payment_date` no `useMonthSummary`.
  - Buscar `visits` concluídos com `completion_date` no mês e os `payments` ativos dessas visitas/OSs (sem janela de data no pagamento).
  - Função auxiliar `paymentCompetenceMonth(payment, visitsById, ordersById)` aplicando a regra: `visit.completion_date` → conclusão mais recente da OS → `payment_date`.
  - `received`, `receivedNet`, `fees`, `feesByChannel` e `cashResult` passam a usar esse conjunto filtrado; `revenue` (competência) segue igual.
  - Manter `fetchPayments(from, to)` como está para a página de Pagamentos e demais telas que listam por data de pagamento.
- `src/routes/_authenticated/dre.tsx`: ajustar apenas o rótulo do bloco de caixa.
- Sem alteração de schema e sem correção de dados.
