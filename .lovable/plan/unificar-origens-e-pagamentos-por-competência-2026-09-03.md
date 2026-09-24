# Unificar Origens e Pagamentos por competência

## Diagnóstico confirmado de agosto

Os números atuais não representam o mesmo conjunto:

- **Origens: R$ 27.379,98** — 42 serviços concluídos, pertencentes a 36 OS e 35 clientes.
- **Pagamentos: R$ 22.628,82** — 41 lançamentos pagos em agosto, pertencentes a 33 OS.
- “35” em Origens é a quantidade de **clientes únicos**, não de pagamentos nem de OS.

A conciliação identificou:

- Sem pagamento ativo: OS 1542-R (**R$ 2.514,74**), OS 1542 (**R$ 999,14**), OS 1576 (**R$ 960,00**) e OS 1568 (**R$ 600,14**).
- Pagamento menor que o serviço: OS 1543 (**R$ 94,90**), OS 1584 (**R$ 30,00**) e OS 1567 (**R$ 14,00**).
- Pagamento acima do serviço: OS 1513 (**R$ 316,00 acima**) e OS 1563 (**R$ 540,00 acima**).
- Há também pagamento de agosto referente a OS sem serviço concluído no período, por isso contar lançamentos não equivale a contar clientes ou OS.

## Ajuste proposto

1. **Criar uma única regra de competência financeira**
   - O mês será definido pela conclusão do serviço associado ao pagamento.
   - Somente pagamentos ativos com status “Pago” entrarão no faturamento recebido.
   - Pagamentos sem vínculo direto com visita usarão a conclusão da OS, com tratamento explícito para OS com mais de uma visita.

2. **Alinhar a página Origens ao valor efetivamente recebido**
   - “Faturamento do período” e os valores por origem usarão apenas os pagamentos recebidos atribuídos aos serviços concluídos no período.
   - Manter separadamente “Valor dos serviços realizados” para não perder a visão operacional.
   - Mostrar claramente as contagens de serviços, OS, clientes e pagamentos, sem chamar clientes de OS.
   - Origens não terá lista de pendências: apenas a diferença total, com link para “A receber”.

3. **Concentrar as pendências na página A receber**
   - As OS e saldos sem pagamento que causam a diferença continuam listados em “A receber”, como já acontece hoje.
   - Saldos dispensados (desconto/dispensa de saldo) não contam nem como receita nem como a receber, mantendo o comportamento atual.
   - Cada pendência permite abrir a OS para registrar ou corrigir o pagamento.


4. **Adicionar filtro de referência em Pagamentos**
   - Alternar entre “Data do pagamento” (caixa) e “Mês do serviço” (competência).
   - No modo competência, o total de Pagamentos será exatamente a mesma base usada em Origens.
   - Manter bruto, taxas e líquido separados.

5. **Corrigir o DRE para receita somente recebida**
   - Hoje o DRE soma o valor de todos os atendimentos concluídos do mês, mesmo sem pagamento algum, e por isso agosto aparece como R$ 27.379,98.
   - A “Receita realizada” passará a considerar apenas pagamentos recebidos, atribuídos ao mês do serviço.
   - “Receita por origem”, “por vendedora” e “por tipo de serviço” usarão a mesma base recebida, rateando o pagamento entre os atendimentos da OS quando houver mais de um.
   - Comissões e margem serão recalculadas sobre a receita recebida, mantendo o custo do mês por competência.
   - Serviços realizados sem pagamento aparecerão em uma linha separada, “A receber de serviços do mês”, fora da receita.

6. **Tratar corretamente múltiplos pagamentos**
   - Não marcar como duplicado apenas por ser da mesma OS: parcelas e pagamentos separados continuam válidos.
   - O alerta de possível duplicidade ficará restrito a lançamentos realmente idênticos e será apenas informativo, sem excluir valores automaticamente.

7. **Validar agosto**
   - Conferir OS por OS e garantir que DRE, Origens e Pagamentos no modo “Mês do serviço” fechem no mesmo total.
   - Confirmar que o modo “Data do pagamento” continue mostrando o caixa real de agosto.
   - Conferir que as quatro OS sem pagamento e os saldos apontados saiam da receita e apareçam como a receber.

## Detalhes técnicos

- Centralizar a atribuição de competência, o rateio por atendimento e a conciliação em `src/lib/reports.ts`.
- Atualizar `src/routes/_authenticated/origens.tsx`, `src/routes/_authenticated/pagamentos.tsx` e `src/routes/_authenticated/dre.tsx`.
- Registrar a tarefa do DRE em `roadmap.md` no início da execução.
- Não alterar nem excluir pagamentos automaticamente e não fazer mudança de banco de dados.

