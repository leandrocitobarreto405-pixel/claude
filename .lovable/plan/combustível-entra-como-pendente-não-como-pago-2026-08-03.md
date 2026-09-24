# Combustível entra como pendente, não como pago

Hoje, ao salvar a rota, a despesa de combustível é criada já como "Pago". Vai passar a entrar como **Pendente**, para você conferir e dar baixa depois — de uma vez no fim do mês ou por semana.

## O que muda

- A despesa de combustível é lançada com status **Pendente**, sem data de pagamento.
- O valor fica no campo "valor previsto"; o valor efetivamente pago só é preenchido quando você registrar o pagamento na página Despesas (botão de baixa que já existe).
- **Vencimento**: último dia do mês da rota — assim ela aparece agrupada no fechamento mensal. Você pode alterar o vencimento à mão na página Despesas se quiser pagar por semana.
- Se você recalcular e salvar o mesmo dia/técnico de novo: o valor previsto e a observação são atualizados, mas se a despesa já estiver **paga**, o status e a baixa são preservados (não volta para pendente).
- A mensagem de sucesso passa a dizer que o combustível foi lançado como pendente.

## Parte técnica

- `src/routes/_authenticated/rotas.tsx`, no fluxo de salvar: despesa com `status: "Pendente"`, `payment_date: null`, `actual_amount: null`, `due_date` = último dia do mês de `route_date`.
- Na atualização de despesa existente, ler também `status` e atualizar apenas `expected_amount`/`notes`/`due_date` quando `status === "Pago"`; caso contrário atualizar o registro completo como pendente.
- Nenhuma mudança de schema ou de banco.
