# Etapa 3 — Chatwoot → Nexa OS → Lead (MVP)

Situação em 27/09/2026: **código pronto e testado com eventos simulados**, inclusive no Supabase de
desenvolvimento. Falta a validação com uma conversa real, que depende de o app estar publicado num
endereço público (ver "Próximos passos").

## Como funciona

```
Chatwoot (conta da Nexa, uma caixa de entrada por cliente)
   │  webhook  POST /api/public/hooks/chatwoot/<token>
   ▼
Rota do app ── confere o token e, se ligado, a assinatura X-Chatwoot-Signature
   ▼
receber_evento_chatwoot (banco) ── grava o evento uma única vez (chave de deduplicação)
   ▼
processar_evento_chatwoot ── numa transação: contato → conversa → lead → mensagem
```

- **Empresa certa**: definida pela caixa de entrada (`chatwoot_inboxes`). Um evento de uma caixa
  ainda não mapeada fica guardado como "Caixa não mapeada". Ao mapear a caixa, ele é processado.
- **Contato ≠ lead**: o contato (`whatsapp_contacts`) é a pessoa. O lead (`crm_leads`) é a
  oportunidade. Um contato tem no máximo um lead aberto. Depois que o lead é encerrado, uma nova
  conversa só abre lead novo após **30 dias** (D6); antes disso, volta para o lead anterior. O
  prazo fica em `app_settings.crm_novo_lead_apos_dias` de cada empresa.
- **Lead novo**: status "Novo contato", origem "Chatwoot", temperatura "FRIO". Os dados de anúncio
  (`additional_attributes`) ficam em `referral_data`, e o histórico de status é registrado.
- **Cliente existente**: se o telefone já é de um cliente cadastrado, o contato e o lead já nascem
  ligados a ele.
- **Primeira resposta**: a primeira mensagem de saída, não privada, grava `primeira_resposta_em`
  no lead e na conversa. É o marco para o funil da Etapa 4.
- **Segurança**:
  - a URL tem um token aleatório de 64 caracteres;
  - os eventos de outra conta do Chatwoot são recusados;
  - o segredo da assinatura e o token da API ficam numa tabela que o app não lê (só a chave de
    serviço);
  - cada empresa só vê as próprias conversas e eventos.
- **Confiabilidade**: o Chatwoot **não reenvia** um aviso que falhou. Por isso, todo evento é
  gravado antes de ser processado. Um erro fica registrado com a mensagem, sem deixar nada pela
  metade, e pode ser reprocessado:
  - pelo botão "Reprocessar pendentes";
  - pela tarefa `POST /api/public/hooks/chatwoot-reprocessar`, com
    `Authorization: Bearer $NEXA_TAREFAS_SEGREDO`.

  Eventos fora de ordem não sobrescrevem um estado mais novo da conversa.

## Tela: Nexa → Chatwoot

Visível só para administradores da Nexa.

1. **Conectar**: número da conta do Chatwoot (o que aparece em `…/app/accounts/187966/…`).
2. Copiar a **URL do webhook** e cadastrar no Chatwoot, marcando os eventos listados na tela.
3. Opcional: colar o **segredo do webhook** e ligar "Exigir assinatura". O **token da API**
   (plano pago) fica guardado para a reconciliação.
4. **Caixas de entrada → empresas**: informar o número da caixa (em `…/settings/inboxes/12`) e a
   empresa. A tela avisa quando chegam eventos de caixas sem empresa.
5. **Últimos eventos**: situação de cada aviso recebido (processado, ignorado, caixa não mapeada,
   erro).

## Passo a passo no Chatwoot (quando o app estiver publicado)

1. Renomear a conta "turbineclean" para "Nexa Performance" (o ID 187966 não muda).
2. Na tela Nexa → Chatwoot, conectar a conta 187966 e copiar a URL.
3. No Chatwoot: **Configurações → Integrações → Webhooks → Adicionar novo webhook**. Colar a URL
   e marcar: conversation_created, conversation_updated, conversation_status_changed,
   message_created, message_updated, contact_created, contact_updated.
4. Mapear a caixa de WhatsApp da Turbine para a empresa Turbine Clean.
5. Mandar uma mensagem de teste para o número. O lead aparece em CRM → Leads e o evento em
   "Últimos eventos".
6. Assinatura: começar **desligada** (o token da URL já protege). Há um defeito conhecido no
   Chatwoot Cloud (issue #13809): o segredo exibido pode não ser o usado na assinatura. Ligar
   depois de ver os eventos chegando e conferir que continuam chegando.

## Testes

| Comando | O que verifica |
|---|---|
| `npm run test:db` | `supabase/tests/020_chatwoot.sql`: 19 cenários:<br>• contato, lead e conversa criados<br>• duplicidade<br>• mensagem editada<br>• primeira resposta<br>• nota privada<br>• mensagem de sistema<br>• fora de ordem<br>• caixa não mapeada e reprocesso<br>• mesma pessoa em duas empresas<br>• conta/token errados<br>• regra dos 30 dias<br>• erro sem efeito parcial<br>• isolamento e permissões (empresa × Nexa) |
| `npm run test:webhook` | Ponta a ponta por HTTP (20 verificações): sobe o servidor do app e o PostgREST local. Cobre:<br>• token inválido<br>• conta divergente<br>• JSON inválido<br>• duplicidade<br>• caixa não mapeada<br>• assinatura (ausente, segredo errado, antiga, corpo alterado, válida)<br>• estado final no banco<br>• rota de reprocessamento |
| `npm run test:unit` | Verificação da assinatura (6 casos) |

As proteções principais foram validadas com **mutação**: ao desligar cada uma delas o teste
correspondente falha. São a deduplicação, a regra dos 30 dias, a ordem dos eventos e a visibilidade
das caixas.

**No Supabase de desenvolvimento**:
- migrações `20260928120000` e `20260928130000` aplicadas;
- esquema idêntico ao local pela impressão digital;
- o verificador de segurança não aponta nada no que é do Nexa OS;
- fluxo simulado (conversa → mensagem → repetição) executado numa transação desfeita: 1 lead, 1
  mensagem, repetição reconhecida;
- tela testada no navegador (14/14), com contas temporárias já removidas:
  - admin Nexa conecta, copia a URL, grava o segredo, liga a assinatura e mapeia a caixa;
  - a tela funciona no celular;
  - o usuário da empresa não vê o menu nem a tela.

## Próximos passos

1. **Publicar o app** num endereço público HTTPS para o Chatwoot conseguir chamar o webhook. Pela
   D8, é o momento de criar o Google Cloud (Cloud Run). No servidor, configurar
   `SUPABASE_SERVICE_ROLE_KEY` e `NEXA_TAREFAS_SEGREDO`, e agendar a tarefa de reprocessamento a
   cada 5 minutos.
2. Primeiro administrador Nexa real (SQL em `ETAPA-2-ISOLAMENTO.md`).
3. Validação com conversa real (passo a passo acima).
4. Com o plano pago: **reconciliação** pela API do Chatwoot, que busca conversas do período para
   cobrir avisos que nunca chegaram.
