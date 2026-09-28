# Publicação no Google Cloud Run

O app roda no **Cloud Run** (região São Paulo, `southamerica-east1`) a partir do `Dockerfile` do
repositório. O Cloud Build refaz a imagem e publica sozinho a cada push no branch configurado.
O Lovable não é afetado: ele continua com o próprio build.

Custo esperado no início: dentro da cota gratuita do Cloud Run e do Cloud Scheduler (3 tarefas
grátis). O Cloud Build cobra por minuto de build acima da cota; cada build leva cerca de 2 minutos.

## Parte A — Preparar o projeto (Cloud Shell, uma vez)

1. No topo do console, escolha o projeto (ou **Novo projeto** → nome `nexa-os`). Confira em
   **Faturamento** se o crédito de avaliação está ligado ao projeto.
2. Pegue a chave secreta do Supabase **sem colar em nenhum chat**:
   - Supabase → projeto **Nexa OS Sao Paulo** → **Project Settings → API Keys**;
   - em **Secret keys**, clique **New secret key**, com nome `cloudrun`;
   - copie a chave (começa com `sb_secret_`).
3. No Google Cloud, abra o **Cloud Shell** (ícone `>_` no canto superior direito). Cole o bloco
   abaixo e tecle Enter. Quando ele pedir, cole a chave do Supabase: ela não aparece na tela.

```bash
REGIAO=southamerica-east1
PROJETO=$(gcloud config get-value project)
echo "Projeto: $PROJETO"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com \
  cloudscheduler.googleapis.com artifactregistry.googleapis.com
read -s -p "Cole a chave secreta do Supabase e tecle Enter: " CHAVE; echo
printf '%s' "$CHAVE" | gcloud secrets create supabase-service-role-key --data-file=-
unset CHAVE
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create nexa-tarefas-segredo --data-file=-
NUM=$(gcloud projects describe "$PROJETO" --format='value(projectNumber)')
for S in supabase-service-role-key nexa-tarefas-segredo; do
  gcloud secrets add-iam-policy-binding "$S" --role=roles/secretmanager.secretAccessor \
    --member="serviceAccount:${NUM}-compute@developer.gserviceaccount.com" >/dev/null
done
echo "Pronto."
```

O segredo das tarefas (`nexa-tarefas-segredo`) é gerado aleatoriamente e ninguém precisa vê-lo.

## Parte B — Criar o serviço (cliques no console)

1. Menu → **Cloud Run** → **Criar serviço** (ou **Implantar contêiner → Serviço**).
2. Escolha **Implantar continuamente a partir de um repositório** → **Configurar com o Cloud Build**:
   - Provedor **GitHub** → autenticar → instalar o app do Google Cloud Build no repositório
     `leandrocitobarreto405-pixel/claude`.
   - Branch: `^claude/nexa-os-multi-tenant-dl9c3s$`.
   - Tipo de build: **Dockerfile**, local `/Dockerfile` → **Salvar**.
3. Nome do serviço `nexaos`, região **southamerica-east1 (São Paulo)**.
4. Autenticação: **Permitir acesso público** (o app tem login próprio; o webhook usa token).
5. Faturamento: **baseado em solicitações**. Escalonamento: mínimo **0**, máximo **3**.
6. Abra **Contêineres, volumes, rede e segurança** → aba **Variáveis e secrets** → em **Secrets**,
   adicione **Referenciar um secret** duas vezes, expostos como variável de ambiente, versão
   `latest`:
   - `SUPABASE_SERVICE_ROLE_KEY` → secret `supabase-service-role-key`
   - `NEXA_TAREFAS_SEGREDO` → secret `nexa-tarefas-segredo`
7. **Criar**. O primeiro build leva alguns minutos. No fim aparece a URL
   (`https://nexa-os-….southamerica-east1.run.app`).

## Parte C — Tarefa de reprocessamento do Chatwoot (Cloud Shell)

```bash
REGIAO=southamerica-east1
URL=$(gcloud run services describe nexaos --region "$REGIAO" --format='value(status.url)')
gcloud scheduler jobs create http chatwoot-reprocessar --location "$REGIAO" \
  --schedule "*/5 * * * *" --time-zone America/Sao_Paulo --http-method POST \
  --uri "$URL/api/public/hooks/chatwoot-reprocessar" \
  --headers "Authorization=Bearer $(gcloud secrets versions access latest --secret nexa-tarefas-segredo)"
echo "$URL"
```

As tarefas mensais (despesas recorrentes e fechamento de quilometragem) entram quando o
usuário-robô for criado (`ETAPA-2-ISOLAMENTO.md`, passo 4), com as variáveis `NEXA_ROBO_EMAIL` e
`NEXA_ROBO_SENHA`.

## Parte D — Supabase e primeiro acesso

1. Supabase → **Authentication → URL Configuration**: em **Site URL**, informe a URL do Cloud Run.
   Em **Redirect URLs**, adicione `https://…run.app/**`.
2. Abra a URL, crie sua conta e confirme o e-mail.
3. Promova a conta a administrador da Nexa (SQL em `ETAPA-2-ISOLAMENTO.md`, passo 3).
4. Siga o passo a passo do Chatwoot em `ETAPA-3-CHATWOOT.md`.

## Detalhes técnicos

- Build: `NITRO_PRESET=node-server npx vite build` gera `.output/`, um servidor Node autocontido.
  Localmente: `node .output/server/index.mjs` (porta `PORT`, padrão 3000).
- O endereço e a chave **pública** do Supabase entram no build (`ARG` do `Dockerfile`). Eles já
  vão para o navegador de qualquer forma; os dados são protegidos pelo RLS. Para o projeto de
  produção, troque os valores no `Dockerfile`.
- Variáveis em tempo de execução: `SUPABASE_SERVICE_ROLE_KEY` e `NEXA_TAREFAS_SEGREDO`, e depois
  `NEXA_ROBO_EMAIL` e `NEXA_ROBO_SENHA`. `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` são opcionais:
  sem elas, valem os valores do build.
- Google Drive/Docs/Agenda e o resumo por IA ainda dependem do conector do Lovable e ficam
  inativos aqui até a troca por OAuth por empresa.

## Google (Drive, Docs e Agenda)

As variáveis `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (secrets `google-client-id` e
`google-client-secret`) ligam a conexão da conta Google de cada empresa. O passo a passo está em
`GOOGLE-CONTA.md`.
