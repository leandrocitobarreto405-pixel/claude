# Nexa OS — Registro de decisões

Complementa o documento `ETAPA-1-ANALISE-TECNICA.md`. Cada decisão tem a data, o que foi decidido
e o que muda na arquitetura. Itens marcados com **[a confirmar]** foram interpretados a partir da
conversa e devem ser confirmados antes da implementação da parte afetada.

## D1 — Chatwoot na nuvem, uma conta para a Nexa (25/09/2026)

**Decidido:** usar o **Chatwoot Cloud** (app.chatwoot.com), sem depender de computador local.
Ainda não há conta nem plano contratado. Será **uma conta da Nexa com uma inbox de WhatsApp por
empresa cliente** (a própria Turbine Clean e as demais).

**Impacto:**
- A versão é sempre a mais recente do Chatwoot Cloud → os webhooks têm assinatura
  (`X-Chatwoot-Signature`). O bug de verificação (chatwoot/chatwoot#13809) foi relatado
  **justamente no Chatwoot Cloud**. Por isso o token secreto na URL do webhook continua sendo a
  autenticação obrigatória e a assinatura é verificada quando confirmarmos que funciona.
- Um único webhook de conta; a **inbox** identifica a empresa (`chatwoot_inboxes`).
- Os clientes não precisam acessar o Chatwoot; os atendentes da Nexa operam todas as inboxes.
- **Plano:** conferir na página oficial de preços antes de contratar. Fontes de terceiros
  (set/2026) indicam cobrança **por agente/mês**. Também indicam que o plano gratuito tem só
  2 agentes, só chat ao vivo e **não inclui WhatsApp**, e que o WhatsApp entra a partir do plano
  "Startups". **[a confirmar]** se "API e webhooks" estão liberados no plano escolhido. Recomendação:
  usar o período de teste e validar o webhook antes de pagar anual.
- A IA dentro do Chatwoot (como no caso do seu conhecido, com o Claude) é feita pelo recurso de
  **Agent Bot** do Chatwoot, que chama um endpoint externo, ou por uma ferramenta como o n8n. Isso fica
  para a etapa de IA; o Nexa OS poderá ser esse endpoint, usando os dados de lead que já terá.

## D2 — WhatsApp entra pelo Chatwoot; webhook direto da Meta não será usado (25/09/2026)

**Decidido:** o webhook direto da Meta (`/api/public/hooks/whatsapp`) **não está ativo** e o número
da Turbine não foi conectado. O WhatsApp da Turbine e dos clientes será conectado **dentro do
Chatwoot** (WhatsApp Business Platform / Cloud API).

**Impacto:**
- Não há conflito de destino de webhook na Meta. O endpoint direto vira código legado. Ele será
  desativado na Etapa 2 e removido depois que o fluxo pelo Chatwoot estiver validado.
- O processamento atual (`crm-webhook.server.ts`) será a base do processador do Chatwoot: mesma
  ideia de contato → lead → mensagem, agora por empresa.
- **Atribuição de anúncio** (qual anúncio trouxe o lead): verificar no primeiro teste real se o
  Chatwoot repassa esses dados. **[a validar no MVP]**
- Conectar o número ao Chatwoot exige a conta Meta Business da empresa e um número apto à Cloud API.
  Se o número hoje está no app WhatsApp Business, a migração ou o uso conjunto (coexistência)
  precisa ser verificado no momento da conexão. **[a validar]**

## D3 — Projeto novo, sem migrar o banco do Lovable Cloud (25/09/2026)

**Decidido:** o banco atual está no Lovable Cloud e o único usuário é você. O Nexa OS será criado
**neste repositório**, com banco próprio montado a partir das migrações. O banco do Lovable não
será migrado.

**Impacto:**
- A Etapa 2 cria um **Supabase próprio da Nexa** (região São Paulo) aplicando todas as migrações e as
  correções de isolamento. A Turbine Clean entra como a **primeira empresa cliente** criada pelo
  processo normal de cadastro de empresa.
- **[a confirmar]** se existem OSs, pagamentos ou despesas **reais** da Turbine no Lovable que
  precisam ser mantidos (histórico, DRE de meses anteriores). Se existirem, fazemos uma importação
  pontual depois. Se não, começamos do zero.
- Este repositório **não está ligado ao Lovable**; o aviso do `AGENTS.md` veio do código original.
  Mesmo assim, o histórico do Git não será reescrito.

## D4 — Google: clientes com Workspace e com Gmail (25/09/2026)

**Decidido:** há clientes nos dois tipos de conta.

**Impacto:** confirma **OAuth por empresa** ("Conectar Google" nas configurações da empresa),
que funciona para Workspace e Gmail. Não usaremos conta de serviço, que exigiria Workspace e
delegação de domínio. Cada empresa terá sua pasta raiz, seus modelos de documento e sua agenda.
Escopos a validar na Etapa 2: `calendar.events`, `drive.file`, `documents`.

## D5 — Comissão da Nexa (25/09/2026)

**Decidido:**
- A comissão incide sobre o **valor recebido total** de serviços **efetivamente realizados**. As
  duas condições são necessárias: serviço concluído **e** pagamento recebido.
- Vale para **todo atendimento feito pelas atendentes da Nexa** (hoje, Maria e Carol). Elas aparecem
  no sistema como "vendedoras" (`salespeople`) e atendem pela Nexa a empresa cliente (Turbine Clean).

**Impacto no desenho (substitui a seção 14.3 do relatório):**
- A comissão que já existe por vendedora (`salespeople.commission_percentage`, congelada na OS,
  regra `on_completion`) **é a semente da comissão Nexa** e será reaproveitada, não duplicada:
  - `salespeople` ganha vínculo com o usuário da Nexa (`user_id`) e a indicação de que é atendente
    Nexa (`atendente_nexa = true`). Uma atendente pode atender várias empresas.
  - A OS já guarda quem vendeu (`work_orders.salesperson_id`) → define se a venda é comissionável.
- **Base de cálculo:** soma do **valor bruto recebido** (`payments.gross_amount`, pagamentos ativos
  e com status pago) de atendimentos **concluídos**, em OS cuja vendedora é atendente Nexa, no
  período de apuração. **[a confirmar]** "Valor recebido total" foi interpretado como **bruto**, sem
  descontar a taxa da maquininha.
- **Percentual por contrato com o cliente** (`contratos_comissao`, com vigência) e apuração mensal
  congelada ao fechar (`apuracoes_comissao` + itens), com status devida / paga / pendente.
- **[a confirmar]** O percentual que a Nexa cobra do cliente é o mesmo que hoje está em
  cada vendedora (3%)? Ou são duas coisas diferentes: o % que o cliente paga à Nexa e o % que a
  Nexa repassa à atendente? A estrutura suporta as duas; a resposta define as telas.

## D6 — Novo lead para contato antigo após 30 dias (25/09/2026)

**Decidido:** um contato que já teve lead **encerrado** gera **novo lead** se voltar a falar
depois de **30 dias** (configurável por empresa, padrão 30). Antes disso, a conversa volta ao lead
anterior. Quem fechou negócio continua marcado como **cliente** (`is_existing_customer` /
vínculo com `customers`) para sempre, independentemente de novos leads.

---

## Plano atualizado

| Etapa | Entrega | Depende de você |
|---|---|---|
| **2 — Fundação e isolamento** | Ambiente próprio: Supabase Nexa e Cloud Run; migrações aplicadas do zero; correções de isolamento R1–R7; papéis Nexa; seletor de empresa; cadastro de empresa pela Nexa; Google direto com OAuth por empresa; testes de isolamento e de regras de cálculo | Projeto Google Cloud com faturamento; conta Supabase; domínio |
| **3 — MVP Chatwoot → Lead** | Conexão, mapeamento de inboxes, webhook, processamento idempotente, log e reprocessamento, reconciliação, leads no painel | Conta Chatwoot Cloud; número da Turbine conectado numa inbox |
| **4 — Funil e indicadores** | Etapas canônicas, marcos, vínculo orçamento↔lead↔OS, dashboard da empresa | — |
| **5 — Painel Nexa + comissão** | Consolidado e apuração da comissão conforme D5 | Respostas [a confirmar] da D5 |
| 6 / 7 | Refinos, Google Sheets se ainda fizer sentido, IA (Agent Bot) | — |

A Etapa 2 pode começar sem o Chatwoot: o código do MVP (Etapa 3) também pode ser escrito e testado
com eventos de exemplo antes de a conta existir. Só a validação com a conversa real depende da
conta e do número conectados.

## Checklist para você providenciar (em paralelo)

1. **Chatwoot Cloud**: criar conta (teste), confirmar no plano que há WhatsApp e
   **Configurações → Integrações → Webhooks**; criar a inbox de WhatsApp da Turbine.
2. **Meta Business** da Turbine com o número que será usado; seguir o assistente de conexão do
   WhatsApp dentro do Chatwoot.
3. **Google Cloud**: criar projeto "nexa-os" com faturamento ativo (você me passa acesso ou executa
   os comandos que eu preparar).
4. **Supabase**: criar conta/organização da Nexa (projeto novo, região São Paulo).
5. **Domínio** para o app (ex.: `app.nexaperformance.com.br`).
