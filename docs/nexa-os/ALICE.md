# Alice: vendedora de IA no Chatwoot

Situação em 28/09/2026: **base pronta e testada**. Ela atende, responde com a tabela de preços, vê
fotos, guarda os dados no lead, consulta a agenda e passa para a equipe. Os próximos passos (ver
o fim deste documento) dependem do jeito de vender da Nexa e da configuração no Google Cloud.

## Como funciona

1. O cliente manda mensagem no WhatsApp, que passa pelo Chatwoot e chega ao Nexa OS pelo webhook,
   que já existia.
2. Com o **robô "Alice"** (agent bot do Chatwoot) ligado na caixa de entrada, as conversas novas
   nascem **pendentes**, e a Alice atende as pendentes.
3. Cada mensagem do cliente agenda uma **tarefa** na fila, com espera de alguns segundos para juntar
   mensagens seguidas. Na hora certa, o **Google Cloud Tasks** chama
   `/api/public/hooks/alice-processar`.
4. O processador:
   1. monta o contexto: instruções da empresa, tabela de preços, formas de pagamento, dados do
      lead, as últimas 40 mensagens e até 4 fotos recentes;
   2. conversa com o **Claude** (Anthropic). A IA pode usar três ferramentas:
      - `atualizar_lead`: nome, estofados, serviço, endereço, resumo e temperatura;
      - `consultar_agenda`: serviços já marcados por dia;
      - `passar_para_atendente`: motivo e resumo;
   3. responde no Chatwoot **como o robô**: a resposta é dividida em até 4 mensagens, com o negrito
      do WhatsApp.
5. **Passagem para a equipe:** o robô escreve uma nota privada com o resumo e muda a conversa para
   **aberta**.
6. **Humano assumiu:** se alguém da equipe escreve na conversa, ou a marca como aberta, a Alice sai
   na hora. Para devolver a conversa a ela, marque como **pendente** no Chatwoot.
7. **Custo e auditoria:** cada resposta fica em `ia_execucoes`, com tokens, custo estimado em US$,
   ferramentas usadas e texto enviado. A tela da Alice mostra os últimos 7 dias e as últimas
   respostas.
8. **Vendido por:** a empresa ganha a vendedora "Alice (IA)", marcada como atendente da Nexa. Ela
   vira a vendedora do lead que atender. Se a Carol ou a Maria fecharem, troca-se na OS. A comissão
   da Nexa é a mesma (D5).

### Proteções
- **Falhas:** em qualquer erro, ou quando a IA recusa ou não sabe responder, a conversa vai para a
  equipe com uma nota explicando. O cliente nunca fica sem resposta.
- **Mensagem nova durante a resposta:** se o cliente escreve enquanto a Alice pensa, a resposta é
  descartada e refeita com tudo junto.
- **Limite:** há um limite de respostas por conversa (40 por padrão); passando disso, a conversa vai
  para a equipe.
- **Preço e desconto:** preço só da tabela, desconto só até o limite configurado.
- **Isolamento:** cada empresa só vê a própria configuração, fila e execuções; só o administrador
  altera a configuração. Os tokens do robô e da API ficam em tabela sem acesso pelo app.
- **Modelo:** Claude Opus 5 com pensamento adaptativo e esforço "médio". O **fallback automático**
  (`fallbacks: "default"`) roda outro modelo se o principal recusar. Nos ajustes avançados dá para
  trocar para Claude Sonnet 5, mais barato.

## Onde se ajusta

- **Empresa: Configurações → Alice (IA)**:
  - ligar e desligar;
  - nome;
  - instruções de venda: área atendida, regras, argumentos, horários;
  - perguntas frequentes;
  - desconto máximo;
  - ajustes avançados: modelo, capricho, espera e limite.

  A tabela de preços, as formas de pagamento e a agenda ela lê do sistema.
- **Nexa: Nexa → Chatwoot → Robô da Alice**: cria o robô na conta do Chatwoot, uma vez só.
- **Código:** `src/lib/alice/`:
  - `prompt.ts`: instruções e histórico;
  - `ferramentas.server.ts`;
  - `motor.server.ts`;
  - `fila.server.ts`;
  - `chatwoot-api.server.ts`.

  Banco: `supabase/migrations/20261002120000_alice_ia.sql`.

## Configuração única no Google Cloud (Cloud Shell)

Pré-requisito: conta em **console.anthropic.com** com créditos e uma **API key** criada. É a
plataforma de API, não a assinatura do Claude. A chave é colada direto no Cloud Shell, nunca em
chat.

```bash
REGIAO=southamerica-east1
PROJETO=$(gcloud config get-value project)
NUM=$(gcloud projects describe "$PROJETO" --format='value(projectNumber)')
CONTA="serviceAccount:${NUM}-compute@developer.gserviceaccount.com"

# Fila do Cloud Tasks e permissão para o app criar tarefas nela.
gcloud services enable cloudtasks.googleapis.com
gcloud tasks queues create alice --location "$REGIAO" --max-attempts=3
gcloud projects add-iam-policy-binding "$PROJETO" --member="$CONTA" \
  --role=roles/cloudtasks.enqueuer >/dev/null

# Chave da Anthropic no Secret Manager.
read -s -p "Cole a API key da Anthropic e tecle Enter: " CHAVE; echo
printf '%s' "$CHAVE" | gcloud secrets create anthropic-api-key --data-file=-
unset CHAVE
gcloud secrets add-iam-policy-binding anthropic-api-key \
  --role=roles/secretmanager.secretAccessor --member="$CONTA" >/dev/null

# Liga tudo no Cloud Run.
gcloud run services update nexaos --region "$REGIAO" \
  --update-secrets=ANTHROPIC_API_KEY=anthropic-api-key:latest \
  --update-env-vars="ALICE_FILA=projects/${PROJETO}/locations/${REGIAO}/queues/alice,ALICE_URL_BASE=https://nexaos-980094719320.southamerica-east1.run.app"
echo "Pronto."
```

Depois:
1. No app, **Nexa → Chatwoot → Criar robô da Alice no Chatwoot**. Usa o token de API já
   cadastrado.
2. **Configurações → Alice (IA)**: preencha as instruções de venda e clique em **Ligar a Alice**.
3. No Chatwoot, a equipe acompanha as conversas da Alice na aba **Pendentes**.

## Testes

| Teste | O que verifica |
|---|---|
| `supabase/tests/060_alice.sql` | Agenda só com a Alice ligada e a conversa pendente. Junta mensagens seguidas. Nota privada e robô não mexem na fila. Humano escreveu: cancela e passa para a equipe. Conversa aberta no Chatwoot cancela. Reserva só na hora e uma vez. Isolamento entre empresas. Só admin altera. Token do robô sem acesso. Validado com mutação. |
| `supabase/tests/api/alice.test.mjs` (em `npm run test:webhook`) | Ponta a ponta com Claude e Chatwoot falsos: foto enviada à IA, preços e instruções no prompt, cache, fallback, ferramentas, duas mensagens enviadas como robô, lead atualizado, Alice como vendedora, custo registrado, humano assume, IA passa para a equipe (aviso + nota + aberta), processador protegido, Alice desligada. |
| `src/lib/alice/prompt.test.ts` | Montagem do histórico, fotos, áudio, divisão das mensagens, custo e instruções. |

## Próximos passos

1. **Jeito de vender:** texto de instruções e perguntas frequentes com a vendedora da Nexa.
2. **Áudio:** transcrever os áudios dos clientes (Google Speech-to-Text) e, se quiser, responder
   em áudio (Google Text-to-Speech).
3. **Fechamento automático:** ferramentas para criar o orçamento e a OS e agendar o serviço, com
   as regras de agenda da empresa.
4. **Repescagem:** a Alice retoma conversas paradas.
