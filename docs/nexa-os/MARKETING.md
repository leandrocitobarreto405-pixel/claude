# Marketing pelo WhatsApp (Campanhas WhatsApp)

Tela: **CRM WhatsApp → Campanhas WhatsApp** (`/marketing`). Você só aprova ou recusa: o Nexa
prepara cada campanha do calendário 10 dias antes, pede aprovação e envia nas datas.

**Nada sai enquanto as flags estiverem desligadas** (Configuração, na mesma tela). Todas começam
desligadas: disparo das campanhas, gatilhos C1, C2 e C3, e avisos no WhatsApp do dono.

## 1. Como funciona

### Base e grupos

- `mkt_contatos`: um contato por telefone (casado com e sem o 9º dígito). Compradores (C) e não
  compradores (N). Entram pela importação (aba **Base**), pelos leads novos do CRM (não comprador)
  e pelas OS concluídas e pagas (comprador, com último serviço e tipo).
- Grupos, recalculados todo dia 1 (e no botão **Recalcular agora**), com histórico por mês
  (`mkt_grupos_historico`):

  | Grupo | Quem                                                                             |
  | ----- | -------------------------------------------------------------------------------- |
  | C1    | Pós-venda: serviço nos últimos 30 dias (o toque é no dia seguinte, pelo gatilho) |
  | C2    | Higienização há 5–7 meses                                                        |
  | C3    | Impermeabilização entre 1 ano e 15 dias e 1 ano e 1 mês                          |
  | C4    | Comprou há 3–12 meses                                                            |
  | C5    | Comprou há mais de 12 meses                                                      |
  | N1    | Orçamento/lead nos últimos 3 meses                                               |
  | N2    | Lead de 3 a 9 meses                                                              |
  | N3    | Lead há mais de 12 meses                                                         |

  Prioridade C1 > C3 > C2 > C4 > C5 > N1 > N2 > N3. Ficam fora: opt-out, sem pós-venda (grupos
  C), lead em negociação, quem recebeu marketing nos últimos 30 dias e quem recusou o mesmo grupo
  ("Agora não" / "Já resolvi") nos últimos 120 dias.

### Campanhas do calendário

1. **D-10** (rotina das 9h): recalcula os grupos, monta os lotes (até 350 por lote, um por dia,
   compradores primeiro, terça a quinta), escolhe o modelo por grupo (C4 `tc_oferta_trimestral`,
   C5 `tc_reativacao_cliente`, N1 `tc_orcamento_retomada`, N2/N3 `tc_sazonal_<mês>`; sem nome
   confiável, a variante `_sn`), confere os modelos no Chatwoot e calcula o custo
   (R$ 0,32 por mensagem). Fica **Aguardando aprovação** e você recebe o aviso.
2. **Modelo não aprovado na Meta** (ou que não dá para preencher): campanha **Bloqueada** + aviso.
   Depois de aprovar o modelo, toque em **Preparar agora**.
3. **Tela de aprovação**: contatos por grupo, prévia com 3 contatos reais, quantos vão sem nome,
   custo, datas e condição (texto + %, ou "sem condição"). Botões **Aprovar**, **Recusar** e
   **Editar datas/condição** (que monta a campanha de novo).
4. **Aprovada**: cada lote sai sozinho na data, a partir das 10h, uma mensagem a cada 8 s,
   só de terça a quinta, antes das 19h e nunca entre 21h e 8h.
5. **Não aprovada até a véspera**: expira, nada sai, e você recebe o aviso (na véspera chega o
   lembrete "aprovação vence hoje").
6. **Travas**: o lote pausa sozinho (e avisa) se os erros de envio passarem de 5% ou se opt-out +
   bloqueio passarem de 3% (a partir de 20 envios no lote). **Pausar** para o lote ou a campanha
   no meio; **Retomar** volta no próximo horário permitido (as travas contam de novo a partir da
   retomada).
7. **Dia 1**: recalcula os grupos e deixa a próxima campanha encaminhada (estimativa na tela).

### Envio

O Nexa envia pela API do Chatwoot (não pela campanha do Chatwoot): acha ou cria o contato (nome =
só o primeiro nome), usa a conversa que já existe ou abre uma (com a Alice, se ela estiver ligada),
manda o modelo com o robô da Alice (não conta como "humano assumiu") e põe a etiqueta do lote
(`camp-AAAA-MM-lN`; gatilhos `gat-c1-AAAA-MM-DD`).

Variáveis dos modelos: com nome, `{{1}}` = primeiro nome e `{{2}}` = condição da campanha; na
variante `_sn`, `{{1}}` = condição. Modelo de campanha "sem condição" não pode ter a variável da
condição (a campanha é bloqueada).

### Gatilhos diários (9h)

- **C1** `tc_posvenda_resultado`: dia seguinte à OS concluída e paga.
- **C2** `tc_higienizacao_6meses`: 6 meses da higienização (uma vez).
- **C3** `tc_imper_13meses` no 13º mês da impermeabilização, e `tc_imper_13meses_lembrete` uma
  vez se não responder em 24 h.
  Com a flag do gatilho desligada, os toques ficam na aba **Gatilhos** ("Gatilhos de hoje") para
  enviar pelo celular e marcar **Enviei** (ou descartar). Ligada, saem sozinhos das 9h às 19h.

### Respostas

Mensagem de quem recebeu disparo nos últimos 7 dias: o lead fica com origem **WhatsApp campanha** e
a campanha do CRM; o envio guarda `respondido_em` e o botão. A Alice atende (mesmo cliente antigo).

- **Não quero mais ofertas** → opt-out, cancela o que estava na fila, tira as etiquetas de
  campanha e põe `optout` (conversa e contato); a Alice se despede.
- **Agora não / Já resolvi** → não recebe outro disparo desse grupo por 120 dias.
- **Tive um problema** → sem pós-venda, a Alice sai, conversa urgente para a equipe + aviso.
- **Ficou ótimo** → a Alice pede a avaliação no Google (link na Configuração) e a indicação.
- Erro 131026 (não entregue/bloqueio) conta como bloqueio; 131050 (parou de receber marketing)
  vira opt-out.
- Orçamento e venda (OS paga) em até 30 dias ficam ligados ao envio (relatório).

### Alice

- `consultar_cliente` mostra a campanha, o grupo, o modelo recebido, a condição (e até quando vale:
  7 dias depois da última data da campanha), indicação e crédito, e o link da avaliação.
- `criar_orcamento` aceita `desconto: "campanha"` ou `"indicacao"` (o percentual vem do sistema, em
  linha separada; o Pix vale sobre o total com desconto; nunca os dois juntos).
- `registrar_indicacao` (nome e telefone): grava a indicação (15% para o indicado no primeiro
  serviço, 15% de crédito para quem indicou quando o indicado paga) e põe o indicado na base.
- Prompt: seção "Leads de campanha" (`docs/nexa-os/alice/turbine-prompt-v4.md`).

### Relatório

Por campanha: enviados, respostas, orçamentos, vendas, valor vendido, opt-outs, custo estimado e
retorno (valor ÷ custo). Alerta na tela quando um lote passa de 3% de opt-out + bloqueio.

## 2. Rotinas no Cloud Scheduler (criar uma vez)

No Cloud Shell. O `--format=none` evita que o comando imprima o cabeçalho com o segredo.

```bash
URL=https://nexaos-980094719320.southamerica-east1.run.app
SEGREDO=$(gcloud secrets versions access latest --secret=nexa-tarefas-segredo)

# Disparo (a cada minuto): com as flags desligadas não envia nada.
gcloud scheduler jobs create http mkt-disparo --location southamerica-east1 \
  --schedule="* * * * *" --time-zone="America/Sao_Paulo" \
  --uri="$URL/api/public/hooks/mkt-disparo" --http-method=POST \
  --headers="Authorization=Bearer $SEGREDO" --attempt-deadline=120s --format=none

# Rotina diária (9h): grupos no dia 1, preparo D-10, expiração, gatilhos, resumo de segunda.
gcloud scheduler jobs create http mkt-diaria --location southamerica-east1 \
  --schedule="0 9 * * *" --time-zone="America/Sao_Paulo" \
  --uri="$URL/api/public/hooks/mkt-diaria" --http-method=POST \
  --headers="Authorization=Bearer $SEGREDO" --attempt-deadline=300s --format=none
```

## 3. Modelos para aprovar na Meta (WhatsApp Manager)

Cada um com a variante `_sn` (sem o nome). Botões de resposta rápida com o texto exato.

| Modelo                                           | Categoria | Corpo (com nome)               | Botões                                                   |
| ------------------------------------------------ | --------- | ------------------------------ | -------------------------------------------------------- |
| `tc_oferta_trimestral`                           | Marketing | `{{1}}` nome, `{{2}}` condição | Quero ver as datas · Não quero mais ofertas              |
| `tc_reativacao_cliente`                          | Marketing | `{{1}}`, `{{2}}`               | Quero ver as datas · Agora não · Não quero mais ofertas  |
| `tc_orcamento_retomada`                          | Marketing | `{{1}}`, `{{2}}`               | Quero o valor · Agora não · Não quero mais ofertas       |
| `tc_sazonal_<mês>` (out, nov, dez, …)            | Marketing | `{{1}}`, `{{2}}`               | Quero orçamento · Não quero mais ofertas                 |
| `tc_posvenda_resultado`                          | Utilidade | `{{1}}`                        | Ficou ótimo · Tive um problema                           |
| `tc_higienizacao_6meses`                         | Marketing | `{{1}}`                        | Quero ver as datas · Já resolvi · Não quero mais ofertas |
| `tc_imper_13meses` e `tc_imper_13meses_lembrete` | Marketing | `{{1}}`                        | Quero ver as datas · Já resolvi · Não quero mais ofertas |
| `nexa_aviso` (avisos para o dono)                | Utilidade | `{{1}}` = texto do aviso       | —                                                        |

Campanha **sem condição**: o modelo não pode ter `{{2}}` (ou a campanha é bloqueada). Os gatilhos
não têm condição.

## 4. Roteiro de teste com os celulares da equipe

Faça antes de importar as planilhas de clientes (ou siga o passo 4 à risca), com todas as flags
desligadas até o passo 5.

1. **Modelos**: confira na aba Campanhas que a prévia mostra os modelos aprovados (o Nexa lê do
   Chatwoot).
2. **Base de teste**: aba Base → importe uma planilha só com os celulares da equipe (coluna
   Telefone e Nome), "Compradores", com a data do último serviço de uns 4 meses atrás (vão para
   C4). Um dos celulares sem nome (para testar a variante `_sn`). Toque **Recalcular agora**.
3. **Campanha de teste** (SQL, no Supabase):
   ```sql
   INSERT INTO mkt_campanhas (empresa_id, nome, tipo, mes_ref, grupos, templates, datas_disparo,
     condicao_texto, condicao_pct)
   VALUES ('11111111-1111-1111-1111-111111111111', 'Teste equipe', 'calendario',
     date_trunc('month', current_date), '{C4}', '{"C4": "tc_oferta_trimestral"}',
     ARRAY[<próxima terça, quarta ou quinta>::date], '10% na higienização', 10);
   ```
   Na tela, **Preparar agora** e confira a prévia, a contagem e o custo.
4. **Só a equipe**: se já houver clientes reais no C4, cancele os envios deles antes de aprovar:
   ```sql
   UPDATE mkt_envios SET status = 'cancelado', erro = 'teste só com a equipe'
    WHERE campanha_id = (SELECT id FROM mkt_campanhas WHERE nome = 'Teste equipe')
      AND normalized_phone NOT IN ('55119XXXXXXXX', '55119YYYYYYYY');
   ```
5. **Aprovar** e ligar **Disparo das campanhas** na Configuração. No dia, a partir das 10h, as
   mensagens chegam espaçadas. Confira: nome certo (e a versão sem nome), etiqueta
   `camp-...-l1` na conversa, conversa com a Alice.
6. **Respostas** (de cada celular): "Quero ver as datas" (a Alice continua a conversa e oferece
   horário ou transfere); pedir orçamento (a Alice aplica a condição da campanha em linha separada
   e o Pix sobre o total com desconto); "Não quero mais ofertas" (despedida, etiqueta `optout`,
   contato marcado); indicar um amigo (nome e telefone de outro celular da equipe).
7. **Pós-venda**: faça uma OS de teste para um celular da equipe, conclua e marque como paga. No dia
   seguinte, às 9h, o toque aparece na aba Gatilhos (flag desligada). Envie pelo celular e marque
   **Enviei**. Para testar o automático, ligue só o C1 num dia em que o único toque seja o da
   equipe (confira a lista na aba Gatilhos antes).
8. **Avisos no WhatsApp**: informe o seu celular e o modelo `nexa_aviso` e ligue "Avisos no meu
   WhatsApp"; o próximo aviso chega em até 1 minuto.
9. Terminado o teste: desligue o disparo, apague a campanha "Teste equipe" se quiser
   (`DELETE FROM mkt_campanhas WHERE nome = 'Teste equipe'`) e importe as planilhas reais.

## 5. Logs

- Cloud Run: `jsonPayload.message:"[mkt]"` (eventos `disparo.*`, `envio.ok`, `envio.erro`,
  `campanha.*`, `rotina.diaria`, `aviso`, `tarefa.erro`).
- Banco: `mkt_eventos` (tudo que o banco fez: grupos, preparo, aprovação, envios, respostas,
  vendas, pausas) e `mkt_avisos`.

```sql
SELECT created_at, tipo, resultado, detalhe FROM mkt_eventos ORDER BY created_at DESC LIMIT 50;
```

## 6. Testes

| Teste                             | O que verifica                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/110_mkt.sql`      | Nome confiável, importação (dedup com/sem 9, comprador vence), lead e OS na base, grupos e exclusões, preparo (lotes, `_sn`, datas, limites), aprovação só até a véspera, janela (terça a quinta, 10h–19h, nunca 21h–8h, flag), conferência antes de cada envio (pausa no meio, flag, opt-out), pausa automática (erro e opt-out, cada um sozinho), retomada, respostas e botões, falhas 131026/131050, orçamento, venda (30 dias), indicação, gatilhos C1/C2/C3/lembrete, relatório, condição até 25%, isolamento e permissões. Proteções validadas com mutação. |
| `supabase/tests/api/mkt.test.mjs` | Rotina D-10 (preparo e bloqueio por modelo pendente), disparo pelo Chatwoot falso (flag, horário, primeiro nome, `_sn`, robô, etiqueta, pausa automática, retomada, conclusão), modelo inexistente no disparo, tarefas (opt-out, prioridade), avisos no WhatsApp e a Alice com cliente da campanha (campanha no `consultar_cliente`, desconto no orçamento, indicação).                                                                                                                                                                                           |
| `src/lib/mkt/modelos.test.ts`     | Modelo aprovado/pendente/inexistente, preenchimento com e sem nome, variáveis nomeadas, cabeçalho com mídia, condição.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
