# Backup provisório do banco (plano — NÃO ligado)

Enquanto o Supabase estiver no plano grátis (DECISOES D12), não há backup restaurável. Proposta:
um `pg_dump` diário para um bucket privado do Google Cloud Storage, guardando 14 dias.

## Como fica

- **Cloud Run Job `backup-banco`** (imagem oficial `postgres:17`, mesma versão do Supabase,
  17.6) roda `pg_dump` em formato compactado (`-Fc`) e grava direto no bucket, montado como
  pasta (`/backup`).
- **Bucket `nexaos-backup-<projeto>`** em `southamerica-east1`: privado (acesso público bloqueado),
  regra de ciclo de vida apaga arquivos com mais de 14 dias.
- **Cloud Scheduler** chama o job todo dia às 3h17 (São Paulo).
- **Senha do banco só no Secret Manager** (`supabase-db-url`, a string de conexão completa). Ela não
  aparece em log, comando nem tela.
- Fora do backup: só os **dados** de `integracao_eventos` (registro bruto dos avisos do Chatwoot,
  já processados; 74 MB). A estrutura da tabela vai. Isso deixa cada cópia em ~42 MB antes da
  compressão e reduz o tráfego de saída do Supabase (o grátis tem 5 GB/mês).

## Custo estimado (por mês)

| Item | Uso | Custo |
|---|---|---|
| Cloud Storage (Standard, São Paulo) | 14 cópias × ~15 MB comprimidas ≈ 0,2 GB | < US$ 0,01 |
| Cloud Run Job | ~1 min/dia | dentro da cota grátis |
| Cloud Scheduler | 1 tarefa | grátis (3 por conta) |
| Secret Manager | 1 segredo | ~US$ 0,06 |
| Tráfego de saída do Supabase | ~42 MB/dia ≈ 1,3 GB/mês | dentro dos 5 GB do grátis |

Total: **menos de US$ 0,10 por mês** (centavos de real).

## Comandos (Cloud Shell) — só depois do ok

1. Pegue a string de conexão no Supabase: **Connect › Session pooler** (porta 5432), com a senha do
   banco. Sem a senha, troque em **Database › Settings › Reset database password** (o app não
   usa essa senha; usa as chaves de API). Grave sem mostrar na tela:
   ```bash
   read -s -p "Cole a string de conexão (postgresql://...) e tecle Enter: " URL; echo
   printf '%s' "$URL" | gcloud secrets create supabase-db-url --data-file=-; unset URL
   ```
2. Bucket privado com 14 dias:
   ```bash
   PROJ=$(gcloud config get-value project); BUCKET="nexaos-backup-$PROJ"
   gcloud storage buckets create "gs://$BUCKET" --location=southamerica-east1 --uniform-bucket-level-access --public-access-prevention
   printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":14}}]}' > /tmp/ciclo.json
   gcloud storage buckets update "gs://$BUCKET" --lifecycle-file=/tmp/ciclo.json
   ```
3. Permissões da conta de serviço padrão (segredo e bucket):
   ```bash
   NUM=$(gcloud projects describe "$PROJ" --format='value(projectNumber)'); SA="${NUM}-compute@developer.gserviceaccount.com"
   gcloud secrets add-iam-policy-binding supabase-db-url --role=roles/secretmanager.secretAccessor --member="serviceAccount:$SA"
   gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --role=roles/storage.objectAdmin --member="serviceAccount:$SA"
   ```
4. O job:
   ```bash
   gcloud run jobs create backup-banco --region=southamerica-east1 --image=postgres:17 \
     --set-secrets=DATABASE_URL=supabase-db-url:latest \
     --add-volume=name=backup,type=cloud-storage,bucket="$BUCKET" --add-volume-mount=volume=backup,mount-path=/backup \
     --task-timeout=15m --max-retries=1 --memory=1Gi \
     --command=sh --args=-c,'pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges --exclude-table-data=public.integracao_eventos -f /backup/nexaos-$(date +%Y-%m-%d).dump'
   gcloud run jobs execute backup-banco --region=southamerica-east1 --wait
   gcloud storage ls -l "gs://$BUCKET"
   ```
5. Todo dia às 3h17:
   ```bash
   gcloud run jobs add-iam-policy-binding backup-banco --region=southamerica-east1 --role=roles/run.invoker --member="serviceAccount:$SA"
   gcloud scheduler jobs create http backup-banco-diario --location=southamerica-east1 \
     --schedule="17 3 * * *" --time-zone="America/Sao_Paulo" --http-method=POST \
     --uri="https://run.googleapis.com/v2/projects/$PROJ/locations/southamerica-east1/jobs/backup-banco:run" \
     --oauth-service-account-email="$SA"
   ```

## Como restaurar (se precisar)

Restaurar sobrescreve dados: só com decisão sua, de preferência num projeto Supabase novo.

```bash
gcloud storage cp "gs://$BUCKET/nexaos-AAAA-MM-DD.dump" .
read -s -p "String de conexão do banco de DESTINO: " DESTINO; echo
pg_restore --no-owner --no-privileges --clean --if-exists -d "$DESTINO" nexaos-AAAA-MM-DD.dump; unset DESTINO
```
(No Cloud Shell, se faltar o `pg_restore` 17: `docker run --rm -it -v "$PWD":/w postgres:17 pg_restore ...`.)

Para desligar: `gcloud scheduler jobs delete backup-banco-diario --location=southamerica-east1` (os
arquivos somem sozinhos em 14 dias).
