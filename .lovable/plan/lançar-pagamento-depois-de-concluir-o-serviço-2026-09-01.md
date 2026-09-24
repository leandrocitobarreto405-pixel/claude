# Lançar pagamento depois de concluir o serviço

## O que está acontecendo

Os pagamentos só nascem no momento em que o serviço é concluído: se você concluiu marcando "cliente não pagou", nenhum registro de pagamento é criado. Por isso, na OS da Paola (1571) o bloco "Pagamento efetivo" fica vazio e não há nada para editar — e ela também não aparece na página de Pagamentos, que lista apenas registros existentes e não tem busca por cliente.

## O que vai mudar

### 1. Lançar pagamento direto na OS

No bloco "Pagamento efetivo" passa a existir o botão **Lançar pagamento**, disponível sempre que houver atendimento concluído. Ele abre o mesmo formulário já usado hoje (canal, forma, parcelas, valor, data, observação), com:

- valor sugerido = o que ainda falta receber da OS;
- seleção do atendimento ao qual o pagamento se refere (quando há mais de um concluído);
- cálculo automático de taxa e valor líquido.

Ao confirmar, o pagamento é criado como "Pago", entra no histórico da OS e no histórico de pagamentos, e aparece na lista da própria OS com as ações de Editar e Reabrir que já existem.

Se a soma dos pagamentos passar do valor combinado da OS, o sistema avisa antes de salvar.

### 2. A receber com atalho para receber

Na página "A receber", cada linha ganha a ação **Registrar pagamento**, que abre o mesmo formulário já com o valor pendente daquele atendimento preenchido — sem precisar entrar na OS.

### 3. Busca por cliente em Pagamentos

A página de Pagamentos ganha um campo de busca por nome do cliente ou número da OS, somado aos filtros de mês, canal e status já existentes.

### 4. Números sempre em dia

Ao lançar o pagamento, faturamento do mês, a receber, pagamentos e DRE são atualizados automaticamente, como já acontece ao editar ou reabrir um pagamento.

## Detalhes técnicos

- `src/lib/payments.ts`: nova função `createPayment({ workOrderId, visitId, values, rates })` que insere em `payments` com `is_active = true`, `payment_status = "Pago"`, taxa/líquido via `computeFees`, e grava `payment_history` com `event_type = "Novo registro"`; validação do total contra o valor combinado da OS.
- `src/components/payment-dialog.tsx`: aceitar `mode: "criar"` com `payment: null` e props `workOrderId`, `visitOptions`, `suggestedAmount`; mantém o restante do formulário e chama `invalidateFinanceQueries` no sucesso.
- `src/routes/_authenticated/os.$osNumber.tsx`: botão "Lançar pagamento" no bloco "Pagamento efetivo" (inclusive quando a lista está vazia), passando atendimentos concluídos e saldo pendente; registrar evento em `work_order_history`.
- `src/routes/_authenticated/a-receber.tsx`: ação por linha abrindo o `PaymentDialog` em modo criar.
- `src/routes/_authenticated/pagamentos.tsx`: input de busca filtrando por nome do cliente e `os_number` no client-side sobre os dados já carregados.
- Sem alteração de schema.
