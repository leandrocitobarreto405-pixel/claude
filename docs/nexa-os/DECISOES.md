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
- **Confirmado em 25/09/2026:** começamos do zero. Nenhum dado do Lovable será importado.
- A organização da Nexa no Supabase já foi criada (login via GitHub).
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
  período de apuração. **Confirmado em 25/09/2026:** é o **valor recebido total (bruto)**, sem
  descontar a taxa da maquininha.
- **Percentual por contrato com o cliente** (`contratos_comissao`, com vigência) e apuração mensal
  congelada ao fechar (`apuracoes_comissao` + itens), com status devida / paga / pendente.
- **Confirmado em 25/09/2026:** o percentual é **por empresa cliente**: **3% para a Turbine Clean**
  e **5% para as demais** (padrão para empresas novas). Os dois são editáveis nas configurações
  da Nexa (ver D7).

## D6 — Novo lead para contato antigo após 30 dias (25/09/2026)

**Decidido:** um contato que já teve lead **encerrado** gera **novo lead** se voltar a falar
depois de **30 dias** (configurável por empresa, padrão 30). Antes disso, a conversa volta ao lead
anterior. Quem fechou negócio continua marcado como **cliente** (`is_existing_customer` /
vínculo com `customers`) para sempre, independentemente de novos leads.

---

## D7 — Tudo que é regra de negócio é configurável no app (25/09/2026)

**Decidido:** percentuais, prazos e parâmetros **não ficam fixos no código**. Eles são editáveis em
telas de configuração, com permissão e histórico de alteração.

**Impacto:**
- **Nível Nexa** (só `nexa_admin`): contrato de comissão por empresa (percentual, base, vigência,
  quais atendentes contam, periodicidade), conexão com o Chatwoot, ligação de cada caixa do Chatwoot
  a uma empresa e valores padrão para empresas novas.
- **Nível empresa** (`admin` da empresa): prazo para abrir lead novo (padrão 30 dias), tempo para
  considerar "sem resposta", validade do orçamento, metas de margem do semáforo, imposto, custo por
  km, taxas de maquininha, tabela de preços, status do CRM e textos (mensagens, termo de garantia).
- Mudança de percentual de comissão cria **nova vigência** em vez de sobrescrever. Assim, meses já
  apurados não mudam.
- Hoje parte dessas configurações já é editável (tabela de preços, taxas, metas de margem, status
  do CRM, modelo de mensagem). O que falta é separar por empresa, criar as telas da Nexa e registrar
  quem alterou.

## D8 — Ambientes e momento de criar o Google Cloud (25/09/2026)

**Decidido:** o Google Cloud dá 90 dias e US$ 300 de crédito a partir da criação. Por isso ele será
criado **só quando o sistema estiver perto de ir ao ar** (fim da Etapa 2 / início do teste real
do Chatwoot). Até lá, o desenvolvimento e os testes rodam neste ambiente, com um Postgres local, e
num projeto Supabase de desenvolvimento.

**Observações do Chatwoot (telas de 25/09/2026):**
- A conta se chama "turbineclean" (ID 187966). Como a decisão é **uma conta da Nexa** com uma caixa
  por cliente, recomenda-se renomear a conta para "Nexa Performance" antes de conectar outros
  clientes. O ID não muda.
- Estão disponíveis: **Webhooks** (desativado), **Robôs** (Agent Bot), caixa de entrada **WhatsApp**
  e canal **API**. O token de acesso à API só aparece no plano pago.

## Plano atualizado

| Etapa | Entrega | Depende de você |
|---|---|---|
| **2 — Fundação e isolamento** | Ambiente próprio: Supabase Nexa e Cloud Run; migrações aplicadas do zero; correções de isolamento R1–R7; papéis Nexa; seletor de empresa; cadastro de empresa pela Nexa; Google direto com OAuth por empresa; testes de isolamento e de regras de cálculo | Projeto Google Cloud com faturamento; conta Supabase; domínio |
| **3 — MVP Chatwoot → Lead** | Conexão, mapeamento de inboxes, webhook, processamento idempotente, log e reprocessamento, reconciliação, leads no painel | Conta Chatwoot Cloud; número da Turbine conectado numa inbox |
| **4 — Funil e indicadores** | Etapas canônicas, marcos, vínculo orçamento↔lead↔OS, dashboard da empresa | — |
| **5 — Painel Nexa + comissão** | Consolidado e apuração da comissão conforme D5 | — |
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
