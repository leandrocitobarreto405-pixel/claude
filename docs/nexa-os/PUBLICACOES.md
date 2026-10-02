# Publicações do redesign e como voltar

O redesign é feito na branch `redesign` e publicado, uma etapa por vez, na branch principal
`claude/nexa-os-multi-tenant-dl9c3s` (a que o Cloud Run `nexaos` publica para a equipe).
Nenhuma etapa até aqui mudou o banco, então voltar a versão do app é seguro.

| Data (UTC)       | Etapa          | Commit publicado | Versão anterior (commit) |
| ---------------- | -------------- | ---------------- | ------------------------ |
| 02/10/2026 00:56 | Base + Agenda  | `86d9d15`        | `4a942a7`                |

## Voltar rápido (cerca de 1 minuto, sem mexer no código)

No Google Cloud, abra o **Cloud Shell** (ícone `>_` no canto superior direito), cole e tecle
Enter. Troque o commit se for voltar uma publicação diferente (coluna "Versão anterior").

```bash
REGIAO=southamerica-east1
COMMIT=4a942a77f18d42442930d311c422894e931ffa5c
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
