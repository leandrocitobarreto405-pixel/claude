# Desconto no a receber, visita de orçamento nas mensagens e campos de valor

## 1. Dispensar saldo (desconto concedido)

Hoje "A receber" compara o valor do atendimento com o que foi pago; se você deu desconto (Pix, negociação), sobra uma diferença que fica eternamente pendente.

Passa a existir, em cada linha de "A receber", a ação **Dispensar saldo**:

- abre uma confirmação com o valor que ficará dispensado (editável, caso queira dispensar só parte) e um motivo (Desconto no Pix, Desconto negociado, Arredondamento, Outro) com observação opcional;
- ao confirmar, o saldo sai de "A receber" e o atendimento fica quitado;
- na OS o atendimento passa a mostrar "Desconto concedido R$ X — motivo", com opção de **desfazer** caso tenha sido erro;
- o desconto não vira receita nem despesa: ele apenas reduz o valor a receber (faturamento continua sendo o que entrou de fato).

## 2. Visita de orçamento nas "Mensagens de amanhã"

A página de mensagens passa a listar também as visitas de orçamento do dia escolhido, junto com os atendimentos, ordenadas por horário:

- selo **Orçamento** no cartão;
- mensagem no mesmo modelo já usado hoje (dia da semana, data, horário, cliente, endereço, técnico), com o serviço aparecendo como "Visita de orçamento" e a descrição do estofado a orçar;
- quando há taxa de visita, a mensagem inclui o valor e a instrução de cobrança; taxa zero não fala de valor;
- botões Copiar mensagem, Abrir no WhatsApp e "Copiar todas" incluem as visitas de orçamento;
- visitas canceladas ficam fora.

## 3. Campos de valor e de parcelas

Corrigir o comportamento de digitação em todos os campos de dinheiro, quilometragem, percentual e parcelas:

- apagar o conteúdo deixa o campo **vazio**, não "0";
- digitar por cima funciona direto, sem precisar apagar um zero preso;
- vírgula e ponto são aceitos como separador decimal e não apagam o que já foi digitado (704,24 funciona digitando na ordem natural);
- teclado numérico no celular;
- ao sair do campo vazio, o valor considerado é zero, sem "travar" o formulário.

Campos afetados: lançar/editar pagamento (valor e parcelas), atendimentos e itens na Nova OS/edição da OS, taxa da visita de orçamento, despesas (valor previsto e valor pago), rotas (km real e custo por km) e configurações de taxas/valores.

## Detalhes técnicos

- **Banco** (migração aditiva): `visits` recebe `discount_amount numeric not null default 0`, `discount_reason text`, `discount_notes text`, `discount_at timestamptz`, `discount_by uuid`. Nada é removido nem renomeado.
- `src/lib/receivables.ts`: valor base do item passa a ser `effectiveVisitValue(v) - discount_amount`; itens com saldo <= 0 continuam saindo da lista; novos totais refletem o desconto.
- `src/lib/payments.ts` (ou novo `src/lib/discounts.ts`): `applyVisitDiscount({ visitId, amount, reason, notes })` e `clearVisitDiscount(visitId)`, ambos gravando evento em `work_order_history` e chamando `invalidateFinanceQueries`.
- `src/routes/_authenticated/a-receber.tsx`: novo diálogo de dispensa por linha; `src/routes/_authenticated/os.$osNumber.tsx`: exibição do desconto no atendimento com ação de desfazer.
- `src/routes/_authenticated/mensagens.tsx`: consulta adicional em `budget_visits` (`BUDGET_VISIT_SELECT`) para o dia, normalizada num tipo comum com `VisitRow`; nova função `budgetVisitMessageContext` em `src/lib/budget-visits.ts` reaproveitando `renderMessage` com `service = "Visita de orçamento"` e cobrança derivada de `visit_fee`.
- Novo `src/components/ui/numeric-input.tsx` com `MoneyInput` (texto, `inputMode="decimal"`, estado string, aceita `,`/`.`, vazio permitido, `onValueChange(number)` no blur/parse) e `IntegerInput` para parcelas; substituir os `type="number"` e os estados numéricos diretos nos arquivos listados acima.
- `supabase--get_types` após a migração.

## Verificação

Dispensar R$ 94 de uma OS com desconto e conferir que sai de "A receber" sem mexer no faturamento; abrir "Mensagens de amanhã" num dia com visita de orçamento e copiar a mensagem; apagar e redigitar 704,24 e 5 parcelas no lançamento de pagamento.
