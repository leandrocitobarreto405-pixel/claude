# Backup provisório do banco (aprovado em 26/10/2026; ligado quando os blocos rodarem)

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

## Comandos (Cloud Shell), um bloco por vez (aprovado em 26/10/2026)

Cada bloco começa definindo o projeto (pelo número dele, 980094719320), então pode rodar em
qualquer ordem de sessão do Cloud Shell.

**Bloco 0: conferir que nada usa a senha do banco** (lista só os NOMES das variáveis do Cloud Run):
```bash
PROJ=$(gcloud projects list --filter="projectNumber=980094719320" --format="value(projectId)")
gcloud config set project "$PROJ"
gcloud run services describe nexaos --region=southamerica-east1 --format=json \
  | jq -r '.spec.template.spec.containers[0].env[] | .name + (if .valueFrom then " (segredo: " + .valueFrom.secretKeyRef.name + ")" else "" end)'
```
Não pode aparecer nada como `DATABASE_URL`, `PGPASSWORD` ou senha do Postgres (o app usa só as chaves
do Supabase).

**Bloco 1: senha do banco e string de conexão no Secret Manager** (sem aparecer na tela):
1. Supabase › Database › Settings › **Reset database password** › **Generate a password** › copie.
2. Supabase › botão **Connect** (topo) › **Connection String** › Method: **Session pooler** › copie a
   string (`postgresql://postgres.avvxapeplhuiruijyyed:[YOUR-PASSWORD]@aws-…-sa-east-1.pooler.supabase.com:5432/postgres`)
   e troque `[YOUR-PASSWORD]` pela senha nova num bloco de notas, sem salvar.
```bash
PROJ=$(gcloud projects list --filter="projectNumber=980094719320" --format="value(projectId)"); gcloud config set project "$PROJ"
gcloud services enable secretmanager.googleapis.com run.googleapis.com cloudscheduler.googleapis.com
read -s -p "Cole a string de conexão (postgresql://...) e tecle Enter: " URL; echo
printf '%s' "$URL" | gcloud secrets create supabase-db-url --data-file=- --replication-policy=automatic; unset URL
gcloud secrets describe supabase-db-url --format="value(name)"
```

**Bloco 2: bucket privado, cópias por 14 dias:**
```bash
PROJ=$(gcloud projects list --filter="projectNumber=980094719320" --format="value(projectId)"); gcloud config set project "$PROJ"
BUCKET="nexaos-backup-$PROJ"
gcloud storage buckets create "gs://$BUCKET" --location=southamerica-east1 --uniform-bucket-level-access --public-access-prevention
printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":14}}]}' > /tmp/ciclo.json
gcloud storage buckets update "gs://$BUCKET" --lifecycle-file=/tmp/ciclo.json
gcloud storage buckets describe "gs://$BUCKET" --format="value(name,location,public_access_prevention)"
```

**Bloco 3: permissões da conta de serviço padrão** (ler o segredo, gravar no bucket, disparar o job):
```bash
PROJ=$(gcloud projects list --filter="projectNumber=980094719320" --format="value(projectId)"); gcloud config set project "$PROJ"
BUCKET="nexaos-backup-$PROJ"; SA="980094719320-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding supabase-db-url --role=roles/secretmanager.secretAccessor --member="serviceAccount:$SA"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --role=roles/storage.objectAdmin --member="serviceAccount:$SA"
```

**Bloco 4: o job e o primeiro backup** (job novo: `--set-secrets` aqui não sobrescreve nada; no
serviço `nexaos` continua valendo só `--update-secrets`):
```bash
PROJ=$(gcloud projects list --filter="projectNumber=980094719320" --format="value(projectId)"); gcloud config set project "$PROJ"
BUCKET="nexaos-backup-$PROJ"
gcloud run jobs create backup-banco --region=southamerica-east1 --image=postgres:17 \
  --set-secrets=DATABASE_URL=supabase-db-url:latest \
  --add-volume=name=backup,type=cloud-storage,bucket="$BUCKET" --add-volume-mount=volume=backup,mount-path=/backup \
  --task-timeout=15m --max-retries=1 --memory=1Gi \
  --command=sh --args=-c,'pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges --exclude-table-data=public.integracao_eventos -f /backup/nexaos-$(date +%Y-%m-%d).dump && ls -l /backup'
gcloud run jobs execute backup-banco --region=southamerica-east1 --wait
gcloud storage ls -l "gs://$BUCKET"
gcloud storage du -s "gs://$BUCKET"
```
O `ls -l` mostra o arquivo `nexaos-AAAA-MM-DD.dump` e o tamanho em bytes (esperado: alguns MB). Se o
`execute` falhar: `gcloud run jobs executions list --job=backup-banco --region=southamerica-east1`
e o link "Logs" do console mostram o motivo (a senha não aparece no log).

**Bloco 4b: uma cópia completa, com os eventos do Chatwoot** (rede de segurança antes da limpeza
dos eventos; só esta vez, sem mudar o job):
```bash
PROJ=$(gcloud projects list --filter="projectNumber=980094719320" --format="value(projectId)"); gcloud config set project "$PROJ"
BUCKET="nexaos-backup-$PROJ"
gcloud run jobs execute backup-banco --region=southamerica-east1 --wait \
  --args=-c,'pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges -f /backup/nexaos-completo-$(date +%Y-%m-%d).dump && ls -l /backup'
gcloud storage ls -l "gs://$BUCKET"
```
A cópia completa também some sozinha em 14 dias (regra do bucket).

**Bloco 5: todo dia às 3h17 (São Paulo):**
```bash
PROJ=$(gcloud projects list --filter="projectNumber=980094719320" --format="value(projectId)"); gcloud config set project "$PROJ"
SA="980094719320-compute@developer.gserviceaccount.com"
gcloud run jobs add-iam-policy-binding backup-banco --region=southamerica-east1 --role=roles/run.invoker --member="serviceAccount:$SA"
gcloud scheduler jobs create http backup-banco-diario --location=southamerica-east1 \
  --schedule="17 3 * * *" --time-zone="America/Sao_Paulo" --http-method=POST \
  --uri="https://run.googleapis.com/v2/projects/$PROJ/locations/southamerica-east1/jobs/backup-banco:run" \
  --oauth-service-account-email="$SA"
gcloud scheduler jobs describe backup-banco-diario --location=southamerica-east1 --format="value(schedule,timeZone,state)"
```

Por que o **pooler de sessão**: a conexão direta do Supabase no plano grátis só aceita IPv6, e o
Cloud Run sai por IPv4; o pooler de sessão (Supavisor, porta 5432) aceita IPv4 e mantém a sessão
inteira, como o `pg_dump` precisa. O pooler de transação (porta 6543) não serve para `pg_dump`.

Trocar a senha do banco não derruba nada (conferido em 26/10): o app, o Cloud Run e as integrações
usam só as chaves de API do Supabase; não há rotina agendada nem servidor externo com a senha no
banco; a única conexão como `postgres` era a da API de gerenciamento do Supabase, que não usa a senha.

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
