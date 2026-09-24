# Semáforo de margem e desconto aplicável no orçamento

## O que a vendedora vai ver

No orçamento, no lugar do bloco de custos atual, um painel **"Pode fechar?"** com:

- **Semáforo**: verde ("pode seguir") com lucro de 20% ou mais; amarelo ("atenção, dá pra fechar") entre 12,5% e 20%; vermelho ("não fechar nesse valor") abaixo de 12,5%.
- **Lucro** em reais e em %.
- **Desconto aplicável**: quanto ainda cabe de desconto até o lucro chegar em 12,5%, e o **valor mínimo** que o orçamento pode ter. Quando já está abaixo do mínimo, mostra quanto falta subir.
- **Quebra dos custos**, linha por linha: deslocamento (do CEP, como já é hoje), produtos, mão de obra, taxa do cartão, imposto e custos fixos.
- **Forma de pagamento** selecionável (à vista, 2x a 5x): a taxa muda e o semáforo recalcula na hora.

Tudo isso é interno — nada disso entra na mensagem do cliente.

## Data do serviço sai do orçamento

O campo **"Data do serviço"** é removido do formulário de criação/edição do orçamento — não é o momento de definir data. O bloco "Melhores dias para este CEP" continua: ao clicar em "Usar esta data", o dia fica guardado internamente no orçamento (visível como texto "Dia escolhido: ..."), sem caixa de data, e preenche a OS quando o orçamento virar OS.

## Como cada custo entra

- **Deslocamento**: km ida e volta estimado pelo CEP x custo por km já configurado.
- **Produtos** e **mão de obra**: digitados no orçamento, como hoje.
- **Taxa do cartão**: percentual da tabela de taxas já cadastrada, conforme a forma escolhida.
- **Imposto**: 6% do valor do serviço (percentual editável nas Configurações).
- **Custos fixos**: soma das despesas fixas do mês dividida pela média de serviços concluídos dos últimos 3 meses, virando um valor por serviço. O valor calculado aparece nas Configurações com explicação e pode ser sobrescrito à mão quando ainda não houver histórico.

Lucro = total do orçamento − todos esses custos.

## Detalhes técnicos

- Migração: `app_settings` ganha as chaves `tax_percent` (6), `profit_target_percent` (20), `profit_min_percent` (12.5) e `fixed_cost_per_service_override`; `quotes` ganha colunas nulas `forma_pagamento`, `parcelas`, `taxa_percentual`, `custo_taxa`, `custo_imposto`, `custo_fixo_alocado`, `lucro_valor`, `lucro_percentual` (aditivo, sem quebrar o app publicado).
- Nova server function `custoFixoPorServico` (em `src/lib/quotes.functions.ts` + `quotes.server.ts`): soma despesas fixas/recorrentes pagas do mês corrente (reaproveitando a lógica de `recurring-core.ts`/`reports.ts`) e divide pela média de visitas concluídas dos últimos 3 meses; retorna também os números que compõem a conta para exibição.
- `computeQuote` em `src/lib/quotes.server.ts` passa a calcular taxa, imposto, custo fixo alocado, lucro e percentual, e a persistir esses campos; a mesma função pura é reutilizada no cliente para o cálculo em tempo real, evitando divergência entre tela e banco.
- Função pura `avaliarMargem(total, custos, limites)` em `src/lib/quotes.ts`: devolve status (verde/amarelo/vermelho), desconto máximo e piso de preço — `pisoPreco = custosVariáveisFixos / (1 − minPct − taxaPct − impostoPct)`, tratando o caso de denominador não positivo.
- UI: novo componente `src/components/margem-orcamento.tsx` usado em `src/routes/_authenticated/orcamentos/$quoteId.tsx`, substituindo o bloco de margem atual; seletor de parcelas com `NativeSelect` e taxas de `usePaymentRates`.
- Configurações: nova seção "Regras de margem" (imposto, faixas de lucro, custo fixo por serviço calculado + override), visível a admin e atendente.
- Mensagem de WhatsApp (`src/lib/quote-message.ts`) permanece intocada.
- Ao final: typecheck/build e verificação no navegador criando um orçamento com desconto.
