# Por que o app continua usando 17 serviços/mês

## O que encontrei

O número 34 está salvo corretamente nas Configurações. O problema é a regra que decide qual média usar.

Serviços concluídos registrados no app:

```text
Julho/2026     1 serviço   (mês em que o app começou a ser usado)
Agosto/2026   42 serviços  (mês cheio)
Setembro/2026  9 serviços  (mês em andamento, ainda incompleto)
```

Como existem "3 meses com serviços", o app concluiu que já tem histórico suficiente e passou a calcular sozinho: (1 + 42 + 9) ÷ 3 = **17**. Ou seja, ele misturou um mês de estreia e o mês atual pela metade com o único mês cheio, e por isso o rateio ficou alto — exatamente o que você notou.

## O que muda

### 1. A sua média manda enquanto você quiser

Na seção "Regras de margem" passa a existir uma escolha clara:

- **Usar a minha média** (34) — opção padrão daqui em diante.
- **Usar a média automática do histórico** — o app mostra ao lado quantos meses cheios ele já tem e qual média daria, para você decidir com informação.

Assim nunca mais a média troca sozinha sem você querer.

### 2. Média automática mais honesta

Quando você escolher a automática, ela passa a considerar só **meses cheios**: o mês atual (em andamento) e qualquer mês anterior ao primeiro mês completo de uso ficam de fora. Com os dados de hoje, isso significa apenas agosto (42), e só depois de 3 meses cheios ela vira uma média de verdade.

### 3. Onde o número aparece

Tanto nas Configurações quanto no painel "Pode fechar?" do orçamento, o texto passa a dizer de onde vem a média em uso ("média informada por você: 34 serviços/mês" ou "média automática de X meses cheios"), com o valor do rateio por serviço logo ao lado.

## Detalhes técnicos

- `app_settings` ganha a chave `services_avg_source` com valor `"manual"` (padrão) ou `"automatico"`; migração aditiva, sem quebrar nada existente.
- `fixedCostPerService` em `src/lib/quotes.server.ts`: passa a agrupar as visitas concluídas por mês, descartar o mês corrente e usar a média só dos meses completos; o retorno ganha `mesesCompletos` e `mediaHistorico` para exibição, e a escolha entre histórico e estimativa passa a seguir `services_avg_source` (override manual de custo fixo continua tendo prioridade máxima).
- `src/routes/_authenticated/configuracoes.tsx`: seletor de origem da média na seção "Regras de margem", exibindo a média automática calculada e quantos meses cheios existem.
- `src/components/margem-orcamento.tsx`: texto da fonte do rateio atualizado para refletir `manual`/`automatico`/`estimativa` com o número de meses.
- Ao final: typecheck/build e verificação no orçamento de que o rateio passa a usar 34.
