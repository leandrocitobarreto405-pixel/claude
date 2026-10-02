# Publicações do redesign e como voltar

Desde 02/10/2026 o redesign é feito direto na branch principal
`claude/nexa-os-multi-tenant-dl9c3s` (a que o Cloud Run `nexaos` publica) e cada etapa é
publicada assim que passa nos testes. A equipe ainda usa no dia a dia o app antigo do Lovable,
que tem banco próprio no Lovable Cloud (`aainaxrwirzrqmesoidz`), separado deste
(`avvxapeplhuiruijyyed`).

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

Voltar a versão do app continua seguro: o app anterior não usa as tabelas novas, e as funções
do banco continuam funcionando com ele (uma promoção criada antes da volta é pausada sozinha,
sem enviar, porque o app anterior não sabe preencher o desconto do Pix).

| Data (UTC)       | Etapa               | Commit publicado | Versão anterior (commit) |
| ---------------- | ------------------- | ---------------- | ------------------------ |
| 02/10/2026 00:56 | Base + Agenda       | `86d9d15`        | `4a942a7`                |
| 02/10/2026 13:41 | Início + Conversas  | `a8568c6`        | `86d9d15`                |
| 02/10/2026 13:59 | Avisos (tela)       | `133e6bc`        | `fab37c7`                |
| 02/10/2026 14:21 | Avisos no WhatsApp  | `91771de`        | `61c19e2`                |
| 02/10/2026 14:31 | Marketing           | `79ef000`        | `8d7cbd9`                |
| 02/10/2026 16:56 | Agenda + promoção   | `f9e84ce`        | `4d9ef1f`                |
| 02/10/2026 17:28 | Modelos de mensagem | `316b11e`        | `2f900e8`                |
| 02/10/2026 18:27 | Notificações push   | `b84c49d`        | `50112f8`                |
| 02/10/2026 18:38 | Tela do serviço     | `3c40039`        | `b84c49d`                |

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
