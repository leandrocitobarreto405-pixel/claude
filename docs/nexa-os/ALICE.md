# Alice: vendedora de IA no Chatwoot

Situação em 29/09/2026: **fase 1 pronta e testada** (ver "Fase 1" abaixo). Ela atende do primeiro
contato até o orçamento, manda vídeo e áudio padrão, transcreve os áudios do cliente, faz
follow-up dentro da janela de 24 h do WhatsApp e passa para a equipe no agendamento, na
negociação e nos casos fora da tabela. O prompt da Turbine Clean está em
`docs/nexa-os/alice/turbine-prompt-v1.md` (também gravado na configuração da empresa).

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
      - `passar_para_atendente`: motivo e resumo (na fase 1 virou `transferir_para_humano`);
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
- **Preço e desconto:** preço só da tabela; o único desconto é o do Pix configurado (fase 1).
- **Isolamento:** cada empresa só vê a própria configuração, fila e execuções; só o administrador
  altera a configuração. Os tokens do robô e da API ficam em tabela sem acesso pelo app.
- **Modelo:** Claude Opus 5.5 (desde 29/09/2026; antes Opus 5) com pensamento adaptativo e esforço "médio". Cache: instruções fixas com ponto de cache próprio e a conversa no cache automático; a hora e os dados do lead vão numa mensagem de sistema no fim, para não quebrar o cache. Mensagens antes de uma ferramenta saem pela ferramenta `enviar_mensagem` (no Opus 5.5, texto solto entre ferramentas pode vir escondido). O **fallback automático**
  (`fallbacks: "default"`) roda outro modelo se o principal recusar. Nos ajustes avançados dá para
  trocar para Claude Sonnet 5, mais barato.

## Onde se ajusta

- **Empresa: Configurações → Alice (IA)**:
  - ligar e desligar;
  - nome;
  - instruções de venda: área atendida, regras, argumentos, horários;
  - perguntas frequentes;
  - Pix, parcelas, validade, raio e horário das mensagens ativas (fase 1);
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

## Fase 1 (29/09/2026)

Base: `alice-prompt.md` (Turbine) e a lista "Alice na Nexa — o que o app precisa ter".

### Instruções
- O texto da empresa (Configurações → Alice → "Prompt da Alice") é o roteiro. O Nexa acrescenta só
  regras técnicas fixas: tudo o que ela escreve vai ao cliente, na ordem; valores só da tabela e
  das ferramentas; quais ferramentas existem **agora** (as citadas no roteiro que ainda não existem
  levam à transferência). A tabela de preços do sistema vale mais que a escrita no roteiro.
- Sem texto da empresa, vale um roteiro padrão simples.

### Ferramentas
| Ferramenta | O que faz |
|---|---|
| `consultar_cliente` | Já é cliente? OS anteriores, orçamentos deste atendimento, retornos pendentes, "IA desligada" / "sem pós-venda". |
| `consultar_cep` | ViaCEP + distância pelas ruas até a base do técnico; dentro/fora do raio configurado. |
| `consultar_tabela_precos` | Tabela ativa, por serviço. |
| `criar_orcamento` | Grava o orçamento (status enviado) no lead e devolve total, parcela (÷ parcelas), Pix (− %) e validade com dia da semana. Nomes da tabela sem diferença de acento/caixa. |
| `enviar_video` / `enviar_audio_padrao` | Só aparecem quando o arquivo está cadastrado. Saem logo depois do texto escrito antes. |
| `agendar_followup` | Tarefa da Alice + repescagem (responsável Alice). Ajusta para o horário permitido; fora da janela de 24 h vira tarefa da equipe. Substitui o follow-up pendente da conversa. |
| `registrar_motivo_perda` | Um dos 6 motivos do playbook (usa o motivo equivalente do CRM ou cria); "Adiou" com data gera repescagem da equipe. |
| `atualizar_etapa` | Status abertos do CRM da empresa. |
| `transferir_para_humano` | Motivo obrigatório: nota privada, repescagem da equipe "agora" e conversa aberta (Alice pausada). |
| `consultar_agenda` | Só com "agenda (fase 2)" ligada nos ajustes; ela ainda não reserva. |

### Follow-up e janela de 24 h
- Na hora do toque, a Alice relê a conversa e escreve a mensagem (ou dispensa, respondendo "NADA").
- Cancela sozinho quando o cliente responde, quando alguém da equipe escreve, quando a conversa sai
  de "pendente" ou quando o cliente é marcado "IA desligada".
- Horário das mensagens ativas (padrão 8h–21h): fora dele, adia para o início do próximo período.
  Passou das 24 h desde a última mensagem do cliente: não envia; a repescagem vira da equipe
  (precisa de modelo aprovado pela Meta — fase 2).
- Tela **CRM → Repescagens**: filtro "Da equipe / Da Alice" e o quadro "O que a Alice fez hoje".

### Controles por cliente (tela do lead, cartão "Alice (IA)")
- **IA desligada**: a Alice não responde, não faz follow-up nem pós-venda; cancela o agendado e
  passa a conversa para a equipe.
- **Sem pós-venda**: a Alice atende, mas sem satisfação/avaliação/reativação.
- **Devolver para a Alice**: volta a conversa para "pendente" no Chatwoot (nota privada avisando).

### Áudio
- Áudios do cliente são transcritos (Google Speech-to-Text v2, síncrono, até 1 minuto) com a conta
  de serviço do Cloud Run e guardados em `whatsapp_messages.transcricao`. Falhou: a Alice recebe
  "áudio que não foi possível transcrever" e pede por escrito.
- Vídeos e áudios padrão: Configurações → Alice → "Vídeos e áudios padrão" (Storage `alice-midias`,
  pasta da empresa; até 16 MB).

### Configuração no Google Cloud (uma vez)
```bash
REGIAO=southamerica-east1
PROJETO=$(gcloud config get-value project)
URL=https://nexaos-980094719320.southamerica-east1.run.app

# Transcrição dos áudios.
gcloud services enable speech.googleapis.com

# Varredura da fila a cada 5 min (rede de segurança dos follow-ups). Usa o mesmo segredo das
# tarefas (secret nexa-tarefas-segredo), lido do Secret Manager sem aparecer na tela.
gcloud services enable cloudscheduler.googleapis.com
gcloud scheduler jobs create http alice-varredura --location "$REGIAO" \
  --schedule="*/5 * * * *" --time-zone="America/Sao_Paulo" \
  --uri="$URL/api/public/hooks/alice-varredura" --http-method=POST \
  --headers="Authorization=Bearer $(gcloud secrets versions access latest --secret=nexa-tarefas-segredo)"
echo "Pronto."
```

### Testes da fase 1
| Teste | O que verifica |
|---|---|
| `supabase/tests/070_alice_fase1.sql` | Cliente respondeu / humano escreveu / conversa saiu de pendente / IA desligada cancelam o follow-up e a repescagem; IA desligada não agenda; mídia só da pasta da empresa; horário válido; repescagem não aponta para tarefa de outra empresa. Validado com mutação. |
| `supabase/tests/api/alice.test.mjs` | Ordem texto → vídeo → orçamento → pergunta; valores (total e Pix) calculados pelo sistema; orçamento gravado no lead; follow-up agendado, cancelado pela resposta, enviado na hora e barrado fora da janela (vira tarefa da equipe); áudio transcrito e entregue à IA; IA desligada; transferência cria tarefa da equipe; varredura protegida. Janela e ordem validadas com mutação. |
| `src/lib/alice/regras.test.ts` | Horário permitido, janela de 24 h, parcela/Pix, validade com dia da semana, datas em São Paulo, nomes da tabela. |

## Próximos passos (fase 2)

1. **Agenda:** `reservar_horario`, `gerar_ordem_servico`, `enviar_dados_tecnico`.
2. **Modelos da Meta** para os toques fora da janela de 24 h, confirmação da véspera e pós-venda.
3. **Pós-venda automático** a partir da OS (véspera, dia seguinte, 6 meses).
4. **Fase 3:** desconto em dia vago, se a empresa quiser.
