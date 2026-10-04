# Publicações do redesign e como voltar

Desde 02/10/2026 o redesign é feito direto na branch principal
`claude/nexa-os-multi-tenant-dl9c3s` (a que o Cloud Run `nexaos` publica) e cada etapa é
publicada assim que passa nos testes. A equipe ainda usa no dia a dia o app antigo do Lovable,
que tem banco próprio no Lovable Cloud (`aainaxrwirzrqmesoidz`), separado deste
(`avvxapeplhuiruijyyed`).

Endereço oficial do app: **https://app.nexaperformanceos.com.br** (Firebase Hosting → Cloud Run).
Webhooks, rotinas agendadas e chamadas pesadas continuam no `run.app`
(https://nexaos-980094719320.southamerica-east1.run.app). Detalhes em `infra/firebase/README.md`.

Mudanças no banco (todas aprovadas em 02/10/2026):

- "Avisos no WhatsApp" (`20261010120000`): só acrescenta campos desligados.
- "Agenda, promoção e contato interno" (`20261011120000` e `20261011120001`): acrescenta as
  tabelas `contatos_internos`, `veiculos`, `agenda_horarios_base` e `agenda_configuracoes`, o tipo
  de campanha "promocao" e troca as funções de reserva e conferência do disparo para cancelar
  envios a contatos internos e respeitar o "Envio ligado" na promoção.
- "Modelos de mensagem" (`20261012120000`): só acrescenta as tabelas `meta_conexoes`,
  `meta_conexao_segredos` (o token da Meta, legível só pelo servidor), `modelos_edicoes` e
  `mensagens_textos`.
- "Notificações no celular" (`20261013120000`): só acrescenta `push_inscricoes`,
  `push_preferencias` e `push_envios`. Avisos pelo WhatsApp desligados em 02/10 (dado, não código).
- "Configuração por empresa" (`20261014120000` e `20261014120001`): acrescenta campos com o
  valor de hoje (modelos por finalidade, dias de disparo, descrição do negócio na Alice) e troca
  as funções de horário, reserva e gatilhos para lerem esses campos. A Turbine ficou com os
  mesmos nomes tc_ e terça a quinta. `20261014120002` (preparação de campanhas) foi aplicada em 03/10 pelo SQL Editor (o Supabase
  pedia uma confirmação que não chegava a esta sessão); a função ficou igual à testada (só as
  quebras de linha vieram no formato do Windows, o que não muda nada).
- "Configuração da empresa" (`20261015120000` e `20261015120001`): acrescenta
  `implantacao_etapas`, a liberação em `empresas` (a Turbine entrou liberada), travas que impedem
  ligar a Alice e os envios de empresa não liberada, e a reserva do disparo passa a ignorar
  empresa não liberada. Voltar o app não precisa mexer no banco: o app anterior não usa nada disso.
- "Cidade e estado" (`20261016120000`): só acrescenta `cidade` e `estado` em `empresas` (Turbine
  São Paulo/SP). O rodízio não precisou de banco: só vale com veículo com dia de rodízio.
- "Listas de leads" (`20261017120000`, aplicada em 04/10): acrescenta campos (datas do orçamento
  e da perda por preço, coordenadas do contato, limite de marketing, chave/listas/margem/km/custo
  de produto da promoção) e funções de leitura das listas. A Turbine ficou com a promoção liberada
  e produto R$ 6 (higienização) e R$ 80 (impermeabilização). A promoção de dia vago (04/10) não
  mexeu no banco: só guarda coordenadas encontradas (contatos e base do técnico) para não
  procurar de novo.
- "Campanhas pelas listas" (`20261018120000`, aplicada em 04/10): campo `listas` nas campanhas (os
  12 rascunhos receberam as listas equivalentes aos grupos), contagem das listas da campanha,
  aprovação dos lembretes do dia e a reserva do disparo passa a cancelar campanha/promoção para
  quem recebeu outra mensagem de marketing nos últimos 30 dias (editável). `20261018120001`
  (preparar campanha pelas listas e segurar os lembretes de 6 meses e 13º mês até a aprovação)
  vai pelo SQL Editor; até lá a preparação continua pelos grupos e os lembretes saem sozinhos,
  como antes. Voltar o app não precisa mexer no banco. A parte 2 foi rodada no SQL Editor em
  04/10 e conferida (funções iguais às testadas).
- "Km guardado e janela dos lembretes" (`20261019120000`, aplicada em 04/10): tabela
  `rotas_distancias` (km pelas ruas já consultados; só o servidor usa) e campanha sem quem está na
  janela do lembrete de 6 meses ou do 13º mês (já vale na contagem). `20261019120001` (a mesma
  regra na preparação da campanha) vai pelo SQL Editor.

Voltar a versão do app continua seguro: o app anterior não usa as tabelas novas, e as funções
do banco continuam funcionando com ele (uma promoção criada antes da volta é pausada sozinha,
sem enviar, porque o app anterior não sabe preencher o desconto do Pix).

| Data (UTC)       | Etapa                 | Commit publicado | Versão anterior (commit) |
| ---------------- | --------------------- | ---------------- | ------------------------ |
| 02/10/2026 00:56 | Base + Agenda         | `86d9d15`        | `4a942a7`                |
| 02/10/2026 13:41 | Início + Conversas    | `a8568c6`        | `86d9d15`                |
| 02/10/2026 13:59 | Avisos (tela)         | `133e6bc`        | `fab37c7`                |
| 02/10/2026 14:21 | Avisos no WhatsApp    | `91771de`        | `61c19e2`                |
| 02/10/2026 14:31 | Marketing             | `79ef000`        | `8d7cbd9`                |
| 02/10/2026 16:56 | Agenda + promoção     | `f9e84ce`        | `4d9ef1f`                |
| 02/10/2026 17:28 | Modelos de mensagem   | `316b11e`        | `2f900e8`                |
| 02/10/2026 18:27 | Notificações push     | `b84c49d`        | `50112f8`                |
| 02/10/2026 18:38 | Tela do serviço       | `3c40039`        | `b84c49d`                |
| 02/10/2026 19:15 | Conversas (espera)    | `716ea28`        | `3c40039`                |
| 02/10/2026 22:19 | Config. por empresa   | `0e7ab52`        | `716ea28`                |
| 02/10/2026 22:44 | Checklist empresa     | `4a6ac5a`        | `30a7c79`                |
| 03/10/2026 13:40 | Cidade e estado       | `78be8c4`        | `e4aa78c`                |
| 03/10/2026 18:32 | Convite (WhatsApp)    | `4e03e42`        | `25a9ad6`                |
| 03/10/2026 20:14 | Esqueci a senha       | `2703b3f`        | `f54d21b`                |
| 04/10/2026 01:07 | Encerrar conversas    | `eeaaa67`        | `ff9f68e`                |
| 04/10/2026 01:46 | Listas de leads       | `869d8bf`        | `0584c05`                |
| 04/10/2026 02:20 | Promoção dia vago     | `523dc67`        | `869d8bf`                |
| 04/10/2026 05:55 | Campanhas e listas    | `e74d8b3`        | `b0d51b4`                |
| 04/10/2026 12:23 | Domínio e km guardado | `48e5b05`        | `624dbf1`                |

## Voltar rápido (cerca de 1 minuto, sem mexer no código)

No Google Cloud, abra o **Cloud Shell** (ícone `>_` no canto superior direito), cole e tecle
Enter. Troque o commit se for voltar uma publicação diferente (coluna "Versão anterior").

```bash
REGIAO=southamerica-east1
COMMIT=b84c49dd6fbac8411560bf0a9a42b1111451a857
REV=$(gcloud run revisions list --service nexaos --region "$REGIAO" \
  --filter="metadata.labels.commit-sha=$COMMIT" \
  --sort-by=~metadata.creationTimestamp --format='value(metadata.name)' --limit 1)
echo "Versão anterior: ${REV:-NÃO ENCONTRADA}"
if [ -n "$REV" ]; then
  gcloud run services update-traffic nexaos --region "$REGIAO" --to-revisions="$REV=100"
fi
```

Se aparecer **NÃO ENCONTRADA**, liste as últimas versões e escolha a de antes da publicação
(a coluna da direita mostra o commit):

```bash
gcloud run revisions list --service nexaos --region southamerica-east1 --limit 5 \
  --format='table(metadata.name, metadata.creationTimestamp, metadata.labels.commit-sha)'
gcloud run services update-traffic nexaos --region southamerica-east1 --to-revisions=NOME_DA_VERSAO=100
```

Pelo painel, o mesmo: **Cloud Run** → `nexaos` → aba **Revisões** → marque a versão anterior →
**Gerenciar tráfego** → 100% nela → **Salvar**.

Enquanto o tráfego estiver preso numa versão, as próximas publicações **não** entram no ar.
Para voltar a seguir a versão mais nova:

```bash
gcloud run services update-traffic nexaos --region southamerica-east1 --to-latest
```

## Voltar de vez (pelo código)

Peça ao Claude "desfaz a publicação". Ele cria na principal um commit que desfaz a etapa (sem
apagar histórico, sem problema com o Lovable) e o Cloud Run publica a versão antiga em ~5
minutos. Depois disso, solte o tráfego com `--to-latest` se tiver usado o caminho rápido.

## Pendências

### Fuso horário por empresa (adiado em 03/10/2026)

Fazer só quando entrar uma empresa de **AM, RR, RO, MT, MS ou AC**. Até lá todas as empresas usam o
horário de São Paulo (os outros estados têm o mesmo horário).

Plano aprovado em linhas gerais (Etapa 2 do plano de 03/10):

- Coluna `fuso` em `empresas`, deduzida do estado sempre que ele muda, com São Paulo como padrão:
  AM `America/Manaus`, RR `America/Boa_Vista`, RO `America/Porto_Velho`, MT `America/Cuiaba`,
  MS `America/Campo_Grande`, AC `America/Rio_Branco`; demais estados `America/Sao_Paulo`.
- Funções `private.fuso_empresa(_emp)` e `private.hoje_empresa(_emp)` no lugar do horário fixo.
- Teste com uma empresa em Cuiabá: dispara às 10h de lá, a Alice respeita o horário local.
- Turbine continua com São Paulo: nada muda para ela.

Levantamento feito em 03/10/2026 (para não refazer):

**15 funções do banco com `America/Sao_Paulo` fixo**

| Função                            | Para que serve o horário                          |
| --------------------------------- | ------------------------------------------------- |
| `private.hoje_sp`                 | "hoje" usado por várias outras (contratos, datas) |
| `private.aplicar_evento_chatwoot` | data das mensagens e esperas                      |
| `private.atualizar_marcos_lead`   | datas do funil do lead                            |
| `public.indicadores_funil`        | agrupamento por dia/mês                           |
| `public.mkt_aprovar_campanha`     | véspera do disparo e horário agendado             |
| `public.mkt_calcular_grupos`      | "hoje" dos grupos de marketing                    |
| `public.mkt_confirmar_envio`      | janela de envio antes de mandar                   |
| `public.mkt_criar_promocao`       | datas da promoção                                 |
| `public.mkt_gerar_gatilhos`       | dia dos gatilhos (pós-venda, lembretes)           |
| `public.mkt_importar_contatos`    | datas dos contatos importados                     |
| `private.mkt_os_atualizada`       | data do serviço para os grupos                    |
| `public.mkt_preparar_campanha`    | "hoje" da preparação                              |
| `private.mkt_proximo_horario`     | próximo horário de disparo                        |
| `public.mkt_reservar_envios`      | janela das 8h às 21h, dia e hora do disparo       |
| `public.mkt_retomar`              | horário ao retomar campanha pausada               |

**14 arquivos do app com `America/Sao_Paulo` fixo**

| Arquivo                                                  | O que usa                                  |
| -------------------------------------------------------- | ------------------------------------------ |
| `src/lib/format.ts`                                      | `TZ` das datas mostradas nas telas         |
| `src/lib/alice/regras.ts`                                | `FUSO` do horário de atendimento da Alice  |
| `src/lib/alice/prompt.ts`                                | "hoje é…" no prompt da Alice               |
| `src/lib/alice/marketing.server.ts`                      | "hoje" das campanhas na Alice              |
| `src/lib/conversas.ts`                                   | horários na lista de conversas             |
| `src/lib/inicio.ts`                                      | "hoje" da tela Início                      |
| `src/lib/google-calendar.server.ts`                      | `TIMEZONE` dos eventos da Agenda do Google |
| `src/lib/mkt/campanhas.server.ts`                        | "hoje" das campanhas                       |
| `src/lib/push/notificacoes.server.ts`                    | resumo das 9h e "hoje" das notificações    |
| `src/routes/_authenticated/nexa/chatwoot.tsx`            | horário dos eventos do Chatwoot            |
| `src/routes/_authenticated/nexa/empresas.tsx`            | data inicial da comissão                   |
| `src/routes/_authenticated/orcamentos/index.tsx`         | mês atual dos orçamentos                   |
| `src/routes/api/public/hooks/monthly-mileage-closing.ts` | mês do fechamento de quilometragem         |
| `src/routes/api/public/hooks/recurring-expenses.ts`      | mês das despesas recorrentes               |

Conferir de novo antes de começar: `grep -rl "America/Sao_Paulo" src` e
`SELECT proname FROM pg_proc WHERE prosrc LIKE '%America/Sao_Paulo%'`.
