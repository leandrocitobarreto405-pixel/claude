# Endereço de teste do redesign (branch `redesign`)

O app da equipe (`nexaos`) publica a branch `claude/nexa-os-multi-tenant-dl9c3s`. O redesign
fica na branch `redesign` e é publicado num segundo serviço do Cloud Run, `nexaos-teste`, que
só a pessoa que testa abre. Cada envio na `redesign` atualiza o teste sozinho (3 a 5 minutos).

**O teste usa o mesmo banco (dados reais).** Olhar e navegar é seguro; concluir serviço,
aprovar campanha etc. vale de verdade.

O serviço de teste recebe **só** a chave do Supabase. Sem `NEXA_TAREFAS_SEGREDO`, as rotas de
tarefa (disparo de marketing, Alice, Chatwoot) recusam qualquer chamada, então nada roda em
dobro. Não crie tarefas no Cloud Scheduler nem webhook do Chatwoot apontando para o teste.

## 1. Criar o serviço (painel do Google Cloud)

1. Abra <https://console.cloud.google.com/run>. No topo, confira se o projeto é o mesmo do
   serviço `nexaos` (ele aparece na lista).
2. Clique em **Implantar contêiner** → **Serviço** (em algumas telas: **Criar serviço**).
3. Marque **Implantar continuamente a partir de um repositório (GitHub)** e clique em
   **Configurar o Cloud Build**:
   - Provedor: **GitHub**. Repositório: `leandrocitobarreto405-pixel/claude` (já conectado). Se
     pedir login no GitHub, autorize. Marque a caixa de concordância e clique em **Próxima**.
   - Branch: apague o que estiver e escreva `^redesign$`.
   - Tipo de build: **Dockerfile**. Local da origem: `/Dockerfile`. Clique em **Salvar**.
4. Nome do serviço: `nexaos-teste`. Região: **southamerica-east1 (São Paulo)**.
5. Autenticação: **Permitir acesso público**.
6. Faturamento: **Baseado em solicitações**. Escalonamento: mínimo **0**, máximo **1**.
7. Abra **Contêineres, volumes, rede, segurança** → aba **Variáveis e secrets** → em
   **Secrets expostos como variáveis de ambiente**, clique **Referenciar um secret**:
   - Nome: `SUPABASE_SERVICE_ROLE_KEY`
   - Secret: `supabase-service-role-key`; versão: `latest`.
   - Só este. Não adicione `NEXA_TAREFAS_SEGREDO`, `ANTHROPIC_API_KEY` nem as da Alice.
8. Clique em **Criar**. O primeiro build leva de 3 a 5 minutos.

## 2. Conferir (Cloud Shell)

Abra o Cloud Shell (ícone `>_` no canto superior direito), cole e tecle Enter:

```bash
REGIAO=southamerica-east1
URL=$(gcloud run services describe nexaos-teste --region "$REGIAO" --format='value(status.url)')
echo "Endereço de teste: $URL"
echo "Secrets do teste (deve aparecer só SUPABASE_SERVICE_ROLE_KEY):"
gcloud run services describe nexaos-teste --region "$REGIAO" \
  --format='value(spec.template.spec.containers[0].env[].name)'
if gcloud scheduler jobs list --location "$REGIAO" --format='value(httpTarget.uri)' | grep -q "$URL"; then
  echo "ATENÇÃO: há tarefa agendada apontando para o teste. Me avise."
else
  echo "Certo: nenhuma tarefa agendada aponta para o teste."
fi
```

## 3. Liberar o login (Supabase)

Supabase → projeto **Nexa OS Sao Paulo** → **Authentication** → **URL Configuration** →
em **Redirect URLs**, **Add URL**: o endereço do teste seguido de `/**`
(ex.: `https://nexaos-teste-xxxx.southamerica-east1.run.app/**`) → **Save**.
Não mude o **Site URL**.

## 4. Abrir no celular

Abra o endereço do teste e entre com a conta de sempre. Para instalar:
- iPhone (Safari): **Compartilhar** → **Adicionar à Tela de Início**; troque o nome para
  `Nexa Teste`, para não confundir com o app da equipe.
- Android (Chrome): menu **⋮** → **Adicionar à tela inicial**.

## 5. Juntar com o app da equipe

Quando o redesign for aprovado: Pull Request de `redesign` para
`claude/nexa-os-multi-tenant-dl9c3s` no GitHub → **Merge**. O serviço `nexaos` publica sozinho.
Depois, o `nexaos-teste` pode ser apagado (Cloud Run → marcar → **Excluir**).
