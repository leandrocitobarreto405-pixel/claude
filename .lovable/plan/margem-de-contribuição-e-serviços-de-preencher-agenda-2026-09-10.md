# Margem de contribuição e serviços de "preencher agenda"

## O problema

Hoje o rateio de custos fixos usa a média de serviços concluídos dos últimos 3 meses. Com apenas 1 mês de uso, deu 17 serviços/mês, inflando o custo por serviço — e por isso o app reprova preços que na prática são bons. Além disso, serviços vendidos a R$300 para ocupar a agenda não têm como cobrir o rateio inteiro, mas ainda assim pagam os custos do serviço e deixam boa margem de contribuição.

## O que muda

### 1. Média de serviços informada por você

Nas Configurações, seção "Regras de margem", passa a existir o campo **"Média de serviços por mês"** (você coloca 34). Enquanto não houver 3 meses completos de histórico, o app usa esse número. Quando o histórico chegar a 3 meses, ele passa a calcular sozinho — e mostra qual dos dois está valendo, com o número e a explicação.

### 2. Dois olhares no painel "Pode fechar?"

O painel passa a mostrar duas medidas, sempre:

- **Margem de contribuição**: o que sobra depois dos custos do próprio serviço (deslocamento, produtos, mão de obra, taxa do cartão, imposto). É o que ajuda a pagar os custos fixos.
- **Lucro final**: a margem de contribuição menos o rateio dos custos fixos. É o semáforo que já existe hoje.

### 3. Marcação "Preencher agenda"

No orçamento, uma caixa **"Serviço para preencher agenda (horário ocioso)"**. Quando marcada:

- O semáforo passa a julgar pela **margem de contribuição**, com mínimo de **70%**: verde a partir de 70%, amarelo entre 60% e 70%, vermelho abaixo de 60%.
- O rateio de custos fixos continua aparecendo, mas como informação — não reprova o orçamento.
- O "desconto aplicável" e o "valor mínimo" passam a ser calculados pelo piso de 70% de contribuição (num serviço de R$300 isso dá um piso bem menor do que os ~R$600 do modo normal).
- Um aviso curto lembra que esse serviço não cobre o rateio e deve ser exceção, para ocupar buraco de agenda.

Desmarcada, o comportamento é o de hoje: meta de 20% de lucro final, mínimo 12,5%.

### 4. Configurações

Na seção "Regras de margem" entram: média de serviços/mês, contribuição mínima para preencher agenda (70%) e contribuição de atenção (60%), além do imposto e das faixas de lucro que já existem.

### 5. Km e custo de deslocamento automáticos pelo CEP

Hoje a busca só acontece quando o campo do CEP perde o foco — no celular isso muitas vezes não acontece e nada é calculado, sem nenhum sinal na tela. Passa a:

- Calcular assim que os 8 dígitos do CEP estiverem preenchidos (e ainda ao sair do campo), sem depender de toque em outro lugar.
- Mostrar ao lado do CEP: "Calculando deslocamento..." e depois "X km ida e volta · R$ Y de deslocamento", com um botão "Recalcular".
- Quando o endereço do técnico ou o CEP não permitirem o cálculo, dizer isso na tela e deixar o km editável à mão, como já é.

### 6. Aviso de "salvando"

Todo salvamento do orçamento passa a dar sinal claro: o botão mostra "Salvando..." e fica desabilitado, e ao terminar aparece a confirmação. O mesmo tratamento vale para as ações de status, duplicar e excluir do orçamento, para nunca dar a impressão de app travado.

## Detalhes técnicos

- Migração aditiva: `app_settings` ganha `services_per_month_estimate` (34), `contribution_min_percent` (70) e `contribution_warn_percent` (60); `quotes` ganha coluna `preencher_agenda boolean not null default false` e `contribuicao_percentual numeric`.
- `fixedCostPerService` em `src/lib/quotes.server.ts`: passa a contar meses distintos com visitas concluídas nos últimos 3 meses; com menos de 3 meses de histórico usa `services_per_month_estimate`, senão a média real. Retorna `fonte: "estimativa" | "automatico" | "manual"` e os números que compõem a conta.
- `computeQuote`: calcula `contribuicao_valor`/`contribuicao_percentual` (total − deslocamento − produtos − mão de obra − taxa − imposto) e persiste `preencher_agenda`; `lucro_*` continua descontando o rateio.
- `src/lib/quotes.ts`: `avaliarMargem` ganha `modo: "normal" | "agenda"`. No modo agenda o status vem de `contribuicaoPct` contra `contribution_min/warn`, e o piso é `pisoPreco = custosVariáveisDoServiço / (1 − minContribPct/100 − taxaPct/100 − impostoPct/100)`, com o rateio fora da conta; no modo normal nada muda.
- `src/components/margem-orcamento.tsx`: nova prop `modo`; passa a exibir as duas linhas (contribuição e lucro final), destacar a que manda no semáforo e mostrar o aviso do modo agenda.
- `src/routes/_authenticated/orcamentos/$quoteId.tsx`: checkbox "Preencher agenda" no bloco interno, estado carregado/salvo com o orçamento, repassado a `salvarOrcamento` e ao painel.
- `src/routes/_authenticated/configuracoes.tsx`: novos campos em `RegrasMargem`, com explicação de qual média está em uso.
- CEP: `buscarKm` passa a ser disparado por um `useEffect` com debounce (~600ms) quando `onlyDigits(cep).length === 8` e o CEP mudou, além do `onBlur` atual; estado `buscandoKm` alimenta o texto de status e evita chamadas concorrentes; km/custo de deslocamento exibidos ao lado do campo usando `custoKmConfig`.
- Salvando: `salvando` já existe e é reaproveitado no rótulo do botão ("Salvando..."); adiciono o mesmo estado às ações de status/duplicar/excluir, com `toast` de sucesso/erro.
- Nada disso entra na mensagem de WhatsApp (`src/lib/quote-message.ts` intocado).
- Ao final: typecheck/build e verificação no navegador com um orçamento de R$300 marcado como "preencher agenda".
