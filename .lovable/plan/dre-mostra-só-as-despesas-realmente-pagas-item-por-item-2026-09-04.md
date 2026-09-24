# DRE mostra só as despesas realmente pagas, item por item

Hoje o DRE soma cada despesa pelo valor **previsto** quando ela ainda não foi paga (e mesmo quando você já alterou o valor, o previsto antigo continua entrando). Por isso o DRE não bate com a página de Custos e despesas.

## O que muda

1. **Custos e despesas fixas no DRE = somente o que foi pago.**
   - Despesa pendente: R$ 0,00 no DRE.
   - Parcialmente paga: entra só a parte paga.
   - Paga: entra o valor pago de verdade (o que você editou), não o previsto.
   - Cancelada ou excluída: não entra.
   - Se você reduz o valor de marketing e paga menos, o DRE passa a mostrar exatamente o que foi pago.

2. **Pagamento em mês posterior atualiza o mês da despesa.**
   - Uma despesa de agosto paga em setembro entra no DRE de **agosto** (mês de competência), com o valor pago em setembro.
   - Basta abrir o DRE de agosto depois de pagar: o valor aparece atualizado automaticamente, sem nenhum ajuste manual.
   - A data do pagamento aparece na lista de despesas pagas, deixando claro quando saiu o dinheiro.
   - Na Visão de caixa, o desembolso continua aparecendo no mês em que o pagamento aconteceu.



3. **Nova lista "Despesas pagas no mês" dentro do DRE.**
   - Uma linha por despesa: descrição, categoria, beneficiário, data do pagamento e valor pago.
   - Subtotais por categoria e total geral no fim, batendo com o total de custos fixos do DRE.
   - Ordenada da maior para a menor.

4. **Bloco informativo "Despesas ainda não pagas neste mês"** logo abaixo, apenas para conferência: quanto está pendente/vencido e quanto falta das parcialmente pagas. Esses valores não entram no resultado.

5. **Lucro líquido e margem** passam a ser calculados com o custo pago, ficando coerentes com a receita, que já considera apenas o que foi recebido.

6. **Visão de caixa** continua igual (já usa o pago); o número de custos fixos agora será o mesmo dos dois lados, acabando com a divergência.

## Parte técnica

- `src/lib/reports.ts` (`useMonthSummary`): `fixedCosts` passa a usar `cashPaidAmount(e)` em vez de `actual_amount ?? expected_amount`; novos campos `expensesPaidList` (despesas pagas com valor pago), `expensesPaidByCategory` e `expensesUnpaid` (pendente do mês, fora do resultado). `expensesPending` passa a ser a soma do que não foi pago (previsto − pago) das despesas válidas.
- `src/routes/_authenticated/dre.tsx`: rótulo "(-) Custos e despesas pagas", nova seção com a tabela de despesas pagas + subtotais por categoria e o bloco de não pagas. Sem mudança de banco de dados.
