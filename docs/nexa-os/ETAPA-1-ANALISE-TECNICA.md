# Nexa OS — Etapa 1: Análise técnica do código-base e proposta de arquitetura

> Documento de análise. **Nenhuma funcionalidade foi alterada.** O código recebido foi versionado
> como está (commit de baseline, sem o `.env`) para servir de referência às próximas etapas.
>
> Legenda de confiabilidade: **[confirmado no código]** = lido no código-fonte recebido;
> **[confirmado na fonte do Chatwoot]** = lido no código-fonte oficial do Chatwoot (branch `develop`);
> **[a validar]** = não foi possível confirmar daqui e precisa ser checado na sua instalação.

---

## 0. Resumo executivo

1. **O sistema é mais maduro do que o briefing sugere.** Além de orçamento, OS, agenda, financeiro e
   DRE, ele já tem **CRM de WhatsApp com separação Contato × Lead**, webhook direto da Meta
   idempotente, integrações de leads (Meta Lead Ads / Google Ads / formulário), repescagens,
   campanhas com investimento, rotas e quilometragem automáticas, controle de insumos, pasta no Drive
   por OS, documento da OS e termo de garantia no Google Docs e eventos no Google Agenda.
2. **Stack atual:** TanStack Start (React 19 + SSR + server functions, sobre Vite/Nitro) +
   **Supabase** (Postgres, Auth, RLS, pg_cron), gerado e hospedado pelo **Lovable**. Não é Next.js.
3. **Já existe uma "Parte 3 — Multiempresa"**: tabela `empresas`, `usuarios_empresa`, papéis
   `admin/atendente/tecnico`, `empresa_id` em ~35 tabelas e RLS por empresa. **Mas ela está
   incompleta e tem falhas de isolamento graves** (seção 13). Na prática, hoje o sistema só funciona
   de verdade para uma empresa (Turbine Clean).
4. **Recomendação de stack:** **não migrar para Next.js agora.** TanStack Start cumpre o mesmo papel
   (front + back no mesmo projeto) e migrar ~24 mil linhas não entrega valor de negócio. Manter
   **Postgres/Supabase** (a segurança por RLS já está escrita para ele), tirar a aplicação do Lovable
   e publicar em **Cloud Run**, trocando os "conectores" do Lovable por chamadas diretas às APIs do Google.
5. **Primeira implementação recomendada:** um pacote pequeno de **correções de isolamento** (sem elas,
   receber dados de 30 empresas é inseguro) e, em seguida, o **MVP Chatwoot → Nexa OS → Lead**,
   reaproveitando as tabelas de contato/lead/mensagem que já existem.
6. **Três achados importantes sobre o Chatwoot** (lidos no código-fonte oficial):
   - Webhooks de conta **não são reenviados** se o Nexa OS falhar (sem retry) e têm **timeout de 5 s**
     → precisamos de log durável + reconciliação periódica pela API.
   - A assinatura `X-Chatwoot-Signature` existe nas versões recentes, mas há um **bug aberto**
     (chatwoot/chatwoot#13809, mar/2026) em que o segredo exibido não confere com o usado na assinatura
     → autenticação deve ter um mecanismo que não dependa só da assinatura.
   - No payload de conversa, o campo `id` é o **`display_id`** (número visível da conversa), não o id interno.

---

## 1. Arquitetura atual

```text
Navegador (React 19, TanStack Router, React Query, shadcn/ui, PWA)
   │  ├─ maioria das leituras/escritas: supabase-js direto no PostgREST  (protegido por RLS)
   │  └─ operações sensíveis: "server functions" (createServerFn) com Bearer do usuário
   ▼
Servidor TanStack Start (Nitro; alvo padrão do Lovable = Cloudflare)
   │  ├─ src/lib/*.server.ts  → usa supabaseAdmin (service role, IGNORA RLS)
   │  ├─ rotas públicas /api/public/hooks/* (WhatsApp Meta, leads, jobs)
   │  └─ chamadas externas: Google via "connector-gateway.lovable.dev", IA via "ai.gateway.lovable.dev",
   │     ViaCEP, Nominatim (OSM), OSRM público
   ▼
Supabase (Lovable Cloud): Postgres + Auth + RLS + pg_cron/pg_net
```

Pontos de arquitetura relevantes **[confirmado no código]**:

- **Lógica de negócio majoritariamente no navegador.** Criação/edição de OS, pagamentos, despesas,
  comissão do vendedor, DRE e indicadores são calculados no cliente (`src/lib/os.ts`,
  `payments.ts`, `reports.ts`) e gravados direto nas tabelas. A proteção real é o RLS.
- **Server functions** são usadas para: orçamento (`quotes.server.ts`), rotas/km, Google (Docs,
  Drive, Agenda), mídia da OS, integrações de leads/WhatsApp e IA.
- **Jobs**: `/api/public/hooks/recurring-expenses` e `/monthly-mileage-closing`, chamados por
  pg_cron, autenticados com a chave **publicável** do Supabase (que é pública).
- **Sem testes automatizados** (nenhum arquivo `*.test.*`/`*.spec.*`).
- Histórico de decisões em `.lovable/plan/*.md` (35 planos) — úteis para entender as regras.

## 2. Stack atual

| Camada | Tecnologia |
|---|---|
| Front-end | React 19, TanStack Router/Start 1.16x, React Query 5, Tailwind 4, shadcn/Radix, Recharts, dnd-kit, xlsx, PWA |
| Back-end | TanStack Start server functions + server routes (Nitro), TypeScript |
| Build | Vite 8 via `@lovable.dev/vite-tanstack-config` (Nitro com alvo Cloudflare por padrão) |
| Banco | PostgreSQL gerenciado pelo Supabase (Lovable Cloud, `project_id aainaxrwirzrqmesoidz`) |
| Auth | Supabase Auth (e-mail/senha), JWT enviado às server functions |
| Migrações | `supabase/migrations` (17, ago/2026) + `drizzle/migrations` (14, até set/2026 — só SQL; `drizzle/schema.ts` está vazio) |
| Integrações | Google Docs/Drive/Agenda via conector do Lovable; WhatsApp Cloud API (Meta) direto; Meta Lead Ads/Google Ads/form; IA Gemini via gateway do Lovable; ViaCEP; Nominatim; OSRM |

## 3. Banco atual

PostgreSQL com **RLS habilitado em todas as tabelas**. 45 tabelas públicas. Após a migração
`0005_multiempresa`, quase todas receberam `empresa_id uuid NOT NULL DEFAULT '1111…'` (Turbine Clean)
e uma política única `empresa_id IN (empresas_do_usuario(auth.uid()))`. Funções privilegiadas foram
movidas para o schema `private` (`0012`).

## 4. Entidades existentes (agrupadas)

| Domínio | Tabelas | Observações |
|---|---|---|
| Tenancy / acesso | `empresas`, `usuarios_empresa` (papel `admin/atendente/tecnico`), `convites_empresa`, `users_profiles`, `user_roles` (legado `admin/operator`) | `minha_empresa()` pega **a primeira** empresa do usuário |
| Cadastros | `customers`, `technicians` (com `email` p/ Agenda e endereço-base p/ km), `salespeople` (comissão %), `config_options` (catálogos por `kind`), `app_settings` (chave/valor JSON), `payment_rates` (taxas maquininha/link), `produtos` | `config_options` concentra origem, tipo de serviço, tipo de estofado, status do CRM, motivos etc. |
| Preços / orçamento | `tabela_precos_itens` (preço higienização/impermeabilização por item), `quotes`, `quote_items` | custos, margem, lucro, contribuição gravados no orçamento |
| OS / agenda | `work_orders`, `visits` (atendimentos/serviços da OS), `service_items`, `work_order_history`, `work_order_documents`, `budget_visits` (visita de orçamento), `os_drive_folders`, `os_drive_files`, `os_produtos_utilizados` | uma OS tem N atendimentos; cada atendimento tem N itens |
| Financeiro | `payments`, `payment_history`, `invoice_tasks` (notas), `expenses`, `expense_status_history`, `recurring_expenses`, `technician_expenses`, `monthly_goals` | pagamento com canal, tipo, parcelas, taxa, líquido |
| Logística | `daily_routes`, `route_cost_allocations`, `job_runs` | km por dia/técnico rateado por atendimento |
| CRM | `whatsapp_contacts` (**Contato**), `crm_leads` (**Lead/oportunidade**), `whatsapp_messages`, `crm_status_history`, `crm_followups`, `crm_campaigns`, `campaign_investments`, `crm_source_integrations`, `crm_webhook_events`, `crm_import_batches` | já separa contato × oportunidade: **1 contato → N leads**, no máximo 1 aberto por contato (regra no código) |

Como o sistema guarda cada coisa (pergunta 12 do briefing):
- **Clientes**: `customers` (telefone, e-mail, documento, endereço completo, lat/long).
- **Serviços**: `config_options kind='service_type'` (Higienização, Impermeabilização) + tipos de estofado em `kind='upholstery_type'`.
- **Preços**: `tabela_precos_itens` (por empresa) — base do orçamento.
- **Custos/parâmetros**: `app_settings` (`cost_per_km`, `tax_percent`, `profit_target_percent`,
  `profit_min_percent`, `contribution_*`, `services_per_month_estimate`,
  `fixed_cost_per_service_override`), `payment_rates`, `produtos` (custo por ml), despesas reais.
- **OS**: `work_orders` + `visits` + `service_items`; número em `os_number` (texto, sugerido como máx+1).

## 5. Integrações existentes

| Integração | Como funciona hoje | Dependência |
|---|---|---|
| Google Drive | Cria `Raiz/Materiais dos clientes/AAAA/MM/OS N - Cliente - Turbine Clean/` com `Antes` + `Depois` (higienização) e `Vídeos` (impermeabilização); pasta separada "Controle interno"; upload de mídias; compartilhamento com e-mail do cliente ou link | **Conector do Lovable** (`LOVABLE_API_KEY` + `GOOGLE_DRIVE_API_KEY`) → **uma única conta Google para o sistema todo** |
| Google Docs | Copia modelo (higienização / impermeabilização / combinado), substitui placeholders, preenche tabela de itens; gera **termo de garantia** da impermeabilização; versões | Conector do Lovable; IDs de modelo/pasta em `app_settings.os_document_settings` |
| Google Agenda | Evento por atendimento e por visita de orçamento **numa agenda configurada** (`calendarId`, padrão `primary`), com o **técnico como convidado** (`technicians.email`); cancelamento marca "CANCELADO —" e remove o convite; reagendamento | Conector do Lovable |
| WhatsApp (Meta direto) | `GET/POST /api/public/hooks/whatsapp` com verificação `hub.challenge` e HMAC `X-Hub-Signature-256`; grava evento, contato, lead e mensagem (idempotente por `wamid`); tela de status, reprocessamento e simulação | Segredos `WHATSAPP_*` em variável de ambiente (um número só) |
| Leads externos | `POST /api/public/hooks/leads/{tipo}/{token}` (Meta Lead Ads, Google Ads, formulário) com token por integração + HMAC opcional | por integração (tabela) |
| IA | Resumo/classificação do lead com Gemini | **Gateway de IA do Lovable** |
| Geografia | ViaCEP, Nominatim (OSM) e OSRM público para km | serviços públicos gratuitos |
| Google Sheets | **Não existe.** Há apenas importação de planilha CSV/XLSX no CRM e exportações Excel | — |

## 6. Fluxo atual de orçamento

1. `/orcamentos/novo`: cliente (nome, telefone, CEP, endereço), itens da **tabela de preços**
   (tipo higienização/impermeabilização, preço de tabela × preço aplicado com motivo de desconto,
   quantidade), desconto, valor à vista, forma de pagamento/parcelas/taxa, km ida e volta
   (estimado pelo CEP a partir da base do técnico), custo de produtos e mão de obra, flag
   "preencher agenda".
2. O servidor (`computeQuote`) recalcula: deslocamento = km × custo/km; taxa (só maquininha);
   imposto (`tax_percent`); custo fixo alocado por serviço; **lucro** e **margem de contribuição**.
3. **Semáforo** (`avaliarMargem`): modo normal julga o lucro (verde ≥ alvo, amarelo ≥ mínimo,
   vermelho abaixo); modo "agenda" julga a contribuição. Calcula também o **preço-piso** e o
   **desconto ainda aplicável**.
4. Status: `rascunho → enviado → aprovado | recusado → convertido`. **"Pendente" do briefing = `enviado`.**
5. Mensagem do orçamento para WhatsApp (texto + link `wa.me`), duplicar orçamento.
6. **Aprovado → OS**: botão "Gerar OS" abre a Nova OS **pré-preenchida**; ao salvar, o orçamento vira
   `convertido` com `generated_work_order_id`. Não é automático no momento da aprovação.

Lacuna para o funil: **orçamento não tem vínculo com o lead** (`quotes` não tem `crm_lead_id`).

## 7. Fluxo atual de OS

1. Nova OS (manual, a partir de orçamento, de visita de orçamento ou de lead do CRM): número
   sugerido (máx+1 do que o usuário enxerga), cliente (upsert por telefone), origem, vendedora, forma
   de pagamento negociada, N atendimentos (tipo de serviço, data, hora, técnico, itens).
2. Grava cliente → OS → atendimentos → itens → regra de cobrança → **evento na Agenda** → histórico.
   São várias escritas separadas feitas **pelo navegador, sem transação**.
3. Comissão da **vendedora** (`salespeople`): % congelado na OS; `commission_expected` na criação,
   `commission_realized` proporcional aos atendimentos concluídos.
4. Status da OS: Agendada, Parcialmente concluída, Concluída, Cancelada, Reagendada; atendimento:
   Agendado … Concluído, Reagendado (com/sem deslocamento), Cancelado. Reincidência gera OS `-R`.
5. Conclusão (wizard): produtos usados (se ativo) → gastos do técnico → pagamento; gera nota a
   emitir; no fim cria pastas do Drive, documento da OS e termo de garantia (falhas não bloqueiam).

## 8. Fluxo atual de agenda

- `/agenda`: atendimentos e visitas de orçamento por dia/técnico; sugestão de melhores dias pelo CEP.
- Google Agenda: um evento por atendimento na agenda configurada, técnico como convidado
  (`sendUpdates=all`), duração padrão 120 min, cancelamento/reagendamento sincronizados.
- **Cartão para WhatsApp**: `/mensagens` ("Mensagens de amanhã") monta o texto a partir do modelo
  `app_settings.message_template` (`{{dia_da_semana}}`, `{{numero_os}}`, `{{endereco_completo}}`,
  `{{valor_formatado}}`, instrução de cobrança…) para copiar e colar no grupo dos técnicos.

## 9. Fluxo financeiro

- **Pagamentos**: canal (Pix direto, Dinheiro, Transferência, Maquininha, Link), tipo, parcelas;
  taxa buscada em `payment_rates`; grava bruto, taxa, líquido, status; reabertura com histórico.
- **A receber**: atendimentos concluídos sem pagamento, respeitando a regra de cobrança da OS
  (por serviço, tudo no primeiro, etc.) e saldos dispensados (desconto).
- **Despesas**: manuais, recorrentes (geradas por job), combustível mensal por técnico (rotas),
  gastos do técnico consolidados no mês; status com histórico.
- **Notas a emitir**, **Origens** (faturamento por canal), **Exportações** Excel.

## 10. DRE

`useMonthSummary` (no navegador) por **competência do serviço**:

```text
Receita recebida dos serviços concluídos no mês
(-) Taxas de pagamento
(-) Comissões de vendas
(-) Custo de deslocamento (km)
(-) Produtos usados (CMV, se o controle estiver ligado)
(=) Margem de contribuição
(-) Despesas efetivamente pagas da competência
(=) Lucro líquido
```

Mostra também vendas fechadas, valor de serviços realizados e serviços não recebidos.
**Imposto não aparece como linha própria** no DRE (entra se lançado como despesa); no orçamento ele
é estimado por `tax_percent`.

---

## 11. O que pode ser reaproveitado (e deve ser preservado)

- **Todo o domínio operacional**: orçamento + semáforo, OS/atendimentos/itens, agenda, cobrança,
  pagamentos/taxas, a receber, despesas, rotas/km, insumos, DRE, cartão de WhatsApp, reincidência.
- **Modelo Contato × Lead** (`whatsapp_contacts` 1→N `crm_leads`, mensagens, histórico de status,
  repescagens, campanhas) — é exatamente o conceito pedido; será a base do MVP Chatwoot.
- **Padrão de webhook** já robusto: registro do evento bruto, status, reprocessamento, simulação.
- **Integrações Google**: a lógica de pastas/documentos/eventos pode ser mantida quase intacta — o
  conector do Lovable apenas **repassa as APIs REST oficiais** (`drive/v3`, `docs/v1`,
  `calendar/v3`). Trocar a base da URL e a autenticação resolve a dependência.
- **Base multiempresa**: `empresas`, `usuarios_empresa`, `empresa_id` + RLS em quase tudo.
- UI (AppShell, componentes shadcn, PWA).

## 12. O que precisa ser refatorado

1. **Completar o multi-tenant** (detalhes na seção 14): `empresa_id` explícito em toda escrita,
   remover o `DEFAULT` da Turbine Clean, unicidades por empresa, consistência entre pai e filho,
   configurações por empresa, provisionamento de nova empresa, empresa ativa na interface.
2. **Server functions que usam `supabaseAdmin`** precisam validar empresa e papel antes de agir.
3. **Camada Nexa** (papéis de plataforma, acesso a várias empresas, painel consolidado, comissão Nexa).
4. **Integrações Google por empresa** (cada cliente com sua pasta/agenda/conta) e sem Lovable.
5. **Escritas críticas transacionais no servidor** (criação de OS, conclusão, pagamento) — gradual,
   começando pelo que alimenta comissão Nexa e indicadores.
6. **Indicadores/DRE no banco** (views/funções SQL) em vez de agregar no navegador — necessário para
   o painel consolidado de 30 empresas.
7. **Textos fixos "Turbine Clean"** (nome da pasta no Drive, termo de garantia, título do teste) →
   dados da empresa.
8. **Jobs** autenticados com segredo próprio (não com a chave pública) e executados por empresa.
9. **Geocodificação/rotas**: Nominatim e OSRM públicos não permitem uso comercial intenso.

## 13. Riscos técnicos (priorizados)

| # | Severidade | Risco | Evidência |
|---|---|---|---|
| R1 | **Crítico** | **Acesso entre empresas via server functions.** `getOsDocument`, `generateOsDocument`, `generateOsWarranty`, `syncVisitEvent`, `cancelVisitEvent`, `rescheduleVisitEvent` recebem um id e usam o service role **sem checar a empresa**; `saveOsDocSettings`/`saveCalendarSettings` alteram configurações **globais**. Qualquer usuário logado de qualquer empresa pode ler/alterar dados de outra. | `os-docs.functions.ts`, `calendar.functions.ts`, `os-docs.server.ts`, `calendar.server.ts` (só `os-media.functions.ts` tem `assertWorkOrderAccess`) |
| R2 | **Crítico** | **Cadastro aberto cria empresa.** `registrar_empresa` deixa qualquer pessoa na internet criar conta + empresa — combinado com R1, qualquer pessoa alcança dados de clientes. | migração `0005` + `auth.tsx` |
| R3 | **Alto** | **Novas empresas não conseguem gravar dados.** 58 das 62 escritas (`insert/upsert`) não enviam `empresa_id`; o `DEFAULT` é a Turbine Clean, então o RLS recusa para outras empresas — e escritas via service role caem **silenciosamente na Turbine**. | `grep` em `src/` (só 4 escritas, em `quotes.server.ts` e `os-media.server.ts`, definem `empresa_id`) |
| R4 | **Alto** | **Unicidades globais**: `work_orders.os_number`, `app_settings.key` (chave primária!), `monthly_goals.month`, `whatsapp_contacts.normalized_phone`/`wa_id`, `whatsapp_messages.whatsapp_message_id`, `crm_campaigns.ad_external_id`, `expenses.reference_key`, `recurring_expenses.seed_key`. A empresa B não consegue criar a OS "1842" se a Turbine tiver; não consegue salvar a própria configuração. | migrações `2026080302…`, `…160533` |
| R5 | Alto | **Webhook WhatsApp e simulação gravam na Turbine** e buscam `config_options`/`customers` sem filtrar empresa (com 2+ empresas o `maybeSingle` quebra e o status inicial fica nulo). | `crm-webhook.server.ts`, `crm-integration.functions.ts` |
| R6 | Alto | **Filho de uma empresa pode apontar para pai de outra** (FK simples, RLS só olha a própria linha). | todas as FKs |
| R7 | Médio | `users_profiles` legível por qualquer `admin` global (legado `user_roles`) → e-mail/telefone de usuários de outras empresas. | migração `…032248` |
| R8 | Médio | Escritas em várias etapas pelo navegador sem transação → OS parcialmente criada em caso de falha; valores (inclusive base da comissão) calculados no cliente. Para a **comissão da Nexa**, o cliente poderia alterar/excluir OS e pagamentos que formam a base → precisa de apuração congelada e auditoria. | `os.ts`, `payments.ts` |
| R9 | Médio | Jobs públicos autenticados pela **chave publicável** (pública) e rodando com configurações globais. | `hooks/recurring-expenses.ts`, `monthly-mileage-closing.ts` |
| R10 | Médio | **Dependência do Lovable**: Google (conector), IA (gateway), banco (Lovable Cloud), build (`@lovable.dev/vite-tanstack-config`). Fora do Lovable, Drive/Docs/Agenda/IA param. Também há risco de **conflito de edição** se o projeto continuar sendo alterado no Lovable em paralelo. | `google-*.server.ts`, `crm-ai.functions.ts`, `vite.config.ts`, `AGENTS.md` |
| R11 | Médio | Indicadores e DRE agregados no navegador — não escala para o painel consolidado. | `reports.ts` |
| R12 | Médio | Sem testes automatizados — refatorar o isolamento sem rede de proteção é arriscado. | — |
| R13 | Baixo | Nominatim/OSRM públicos (limites e política de uso). | `geo.server.ts`, `route-calc.server.ts` |
| R14 | Baixo | Contadores do contato incrementados antes de verificar duplicidade da mensagem (não atômico). | `crm-webhook.server.ts` |
| C1 | Chatwoot | Sem retry de webhook de conta, timeout 5 s → evento perdido se o Nexa OS estiver fora/lento (cold start). | seção 16 |
| C2 | Chatwoot | Bug aberto na verificação da assinatura (#13809). | seção 16 |
| C3 | Chatwoot | **Atribuição de anúncio (click-to-WhatsApp)**: hoje o webhook direto da Meta captura `referral` (anúncio de origem). Não confirmei se o Chatwoot repassa esse dado no webhook. **[a validar]** — risco de perder o ROI por campanha. | — |
| C4 | Chatwoot | Um número de WhatsApp só entrega webhooks para **um** app/destino na Meta. Ao conectar o número ao Chatwoot, o webhook direto atual (`/hooks/whatsapp`) deixa de receber. | — |

---

## 14. Proposta de arquitetura multi-tenant

**Modelo:** banco único, schema compartilhado, `empresa_id` em toda tabela de negócio, **isolamento
imposto pelo Postgres (RLS)** e revalidado no servidor. Para ~30 empresas (e bem além disso) é o
modelo mais simples e barato; schema/banco por cliente só se justificaria por exigência contratual.

### 14.1 Papéis

| Nível | Papel | Acesso |
|---|---|---|
| Plataforma (Nexa) | `nexa_admin` | todas as empresas, configurações, comissões, painel consolidado |
| Plataforma (Nexa) | `nexa_atendente` | apenas as empresas atribuídas a ele; CRM/orçamento/OS; sem financeiro global |
| Empresa cliente | `admin` | tudo da própria empresa (usuários, configurações, financeiro, DRE) |
| Empresa cliente | `atendente` | operação, agenda, OS, a receber |
| Empresa cliente | `tecnico` | a própria agenda e conclusão de serviços |

Implementação: tabela `plataforma_usuarios(user_id, papel)` para Nexa; `usuarios_empresa` continua
para os vínculos (um atendente Nexa terá N vínculos). `empresas_do_usuario()` passa a devolver
"todas" para `nexa_admin`. O legado `user_roles/is_staff/has_role` é aposentado.

### 14.2 Regras obrigatórias

1. **Empresa ativa**: a interface trabalha sempre em **uma** empresa (seletor para usuários Nexa); toda
   consulta filtra e toda escrita **envia `empresa_id` explicitamente**. O RLS garante que o valor
   pertence ao usuário.
2. **Remover o `DEFAULT` da Turbine** e bloquear `empresa_id` nulo; gatilho que **preenche/valida o
   `empresa_id` do filho a partir do pai** (visita ← OS, item ← visita, pagamento ← OS…), eliminando R6.
3. **Unicidades por empresa**: `(empresa_id, os_number)`, `(empresa_id, key)` em `app_settings`,
   `(empresa_id, normalized_phone)`, `(empresa_id, month)` etc. Numeração de OS por empresa via
   sequência/contador transacional (não mais "máx+1" no navegador).
4. **Server functions com service role** passam por um único helper
   `requireTenantAccess(ctx, empresaId, papeisPermitidos)` que carrega o recurso **filtrando por
   `empresa_id`**. Configurações (`os_document_settings`, `google_calendar_settings`…) por empresa.
5. **Cadastro fechado**: empresas são criadas pela Nexa (`provisionar_empresa`), que também copia os
   catálogos padrão (`config_options`, status do CRM, tabela de preços modelo, taxas, textos). Usuários
   entram por convite.
6. **Painel Nexa** lê por **funções SQL agregadas** (`SECURITY DEFINER` restritas a `nexa_admin`),
   nunca linhas cruas de todas as empresas.
7. **Testes de isolamento** automatizados: para cada tabela, "usuário da empresa A não lê/grava B".
8. Auditoria: `created_by/updated_by` e histórico onde afeta dinheiro (OS, pagamento, comissão).

### 14.3 Comissão da Nexa

> **Atualizado em 25/09/2026:** a comissão Nexa reaproveita a comissão por vendedora já existente
> (Maria e Carol são atendentes da Nexa). Ver `DECISOES.md`, D5. O modelo abaixo continua válido
> para contratos e apurações.

```text
contratos_comissao (id, empresa_id, vigencia_inicio, vigencia_fim,
                    percentual, base ['servico_realizado' | 'valor_recebido'],
                    servicos_incluidos uuid[] | null, periodicidade ['mensal' …],
                    regras jsonb, ativo)
apuracoes_comissao (id, empresa_id, contrato_id, periodo_inicio, periodo_fim,
                    base_calculada, valor_devido, status ['aberta'|'fechada'|'paga'|'parcial'],
                    fechada_em, fechada_por, pago_em, valor_pago, observacoes)
apuracao_itens     (apuracao_id, work_order_id, visit_id, payment_id, valor_base, valor_comissao)
```

A apuração é **congelada ao fechar** (itens copiados), então alterações posteriores do cliente não
mudam retroativamente o valor devido; ajustes viram lançamentos de correção. `jsonb regras` deixa
espaço para contratos diferentes (faixas, mínimo mensal, só leads vindos da Nexa etc.).

## 15. Proposta de banco (evolução, não reescrita)

Mantém todas as tabelas atuais. Adições/alterações principais:

```text
-- Plataforma
plataforma_usuarios(user_id PK, papel, ativo)
empresas + (slug, status, config_google jsonb, timezone)

-- Chatwoot
chatwoot_conexoes(id, nome, base_url, account_id, api_token_ref*, webhook_secret_ref*,
                  webhook_token UNIQUE, ativo, ultimo_evento_em, ultima_reconciliacao_em)
chatwoot_inboxes(id, conexao_id, inbox_id, empresa_id, nome, channel_type, telefone,
                 ativo, UNIQUE(conexao_id, inbox_id))
integracao_eventos(id, provedor, conexao_id, delivery_id, evento, chave_dedup UNIQUE,
                   account_id, inbox_id, empresa_id, payload jsonb, status, tentativas,
                   erro, recebido_em, processado_em)
conversas(id, empresa_id, conexao_id, chatwoot_conversation_id, inbox_id, contato_id,
          lead_id, status, responsavel_chatwoot_id, responsavel_nome, time, etiquetas text[],
          primeira_resposta_em, aguardando_desde, criada_em, ultima_atividade_em,
          UNIQUE(conexao_id, chatwoot_conversation_id))
chatwoot_agentes(conexao_id, agent_id, nome, email, user_id nullable)

-- Reuso com colunas novas
whatsapp_contacts + chatwoot_contact_id, origem; UNIQUE(empresa_id, normalized_phone)
whatsapp_messages + conversa_id, chatwoot_message_id, tipo_remetente, privada, origem;
                    UNIQUE(empresa_id, origem, id_externo)
crm_leads + etapa (enum canônico), conversa_id, marcos de tempo (ver 16.6),
            UNIQUE parcial (empresa_id, whatsapp_contact_id) WHERE is_open
quotes + crm_lead_id ;  work_orders + crm_lead_id (já existe crm_leads.linked_work_order_id)

-- Indicadores
views/funções: funil_empresa(empresa, de, ate), indicadores_empresa(...), resumo_nexa(de, ate)
```

`*_ref` = referência a segredo no **Secret Manager** (ou coluna criptografada com pgsodium/Vault);
tokens nunca vão para o navegador.

---

## 16. Proposta de integração Chatwoot → Nexa OS

### 16.1 O que o Chatwoot oferece **[confirmado na fonte do Chatwoot]**

- **Webhooks de conta** (Configurações → Integrações → Webhooks, ou API), por conta, com lista de
  assinaturas. Eventos permitidos (`Webhook::ALLOWED_WEBHOOK_EVENTS`):
  `conversation_created`, `conversation_updated`, `conversation_status_changed`,
  `message_created`, `message_updated`, `contact_created`, `contact_updated`,
  `conversation_typing_on/off`, `webwidget_triggered`, `inbox_created`, `inbox_updated`.
- Existe também webhook **por inbox**, mas só para inbox do tipo **API channel** — não serve para
  inbox de WhatsApp. Usaremos o **webhook de conta** e filtraremos por `inbox.id`.
- Envio: `POST` JSON, **timeout padrão 5 s**, **sem nova tentativa** para webhooks de conta
  (a falha só é registrada no log do Chatwoot).
- Cabeçalhos: `X-Chatwoot-Delivery` (UUID da entrega) e, quando o webhook tem segredo,
  `X-Chatwoot-Timestamp` e `X-Chatwoot-Signature = "sha256=" + HMAC_SHA256(secret, "{timestamp}.{corpo_bruto}")`.
- Só é enviado se a conta tiver o recurso "API e webhooks" habilitado.

### 16.2 Conteúdo de cada evento (campos que usaremos)

| Evento | Campos principais |
|---|---|
| `message_created` / `message_updated` | `id` (mensagem), `content`, `message_type` (`incoming`/`outgoing`/`activity`/`template`), `private`, `content_type`, `created_at`, `source_id` (id do WhatsApp), `sender` (contato ou agente), `attachments[]`, `inbox {id,name}`, `account {id,name}`, `conversation {…}` completa |
| `conversation_created` / `_updated` / `_status_changed` | `id` = **display_id**, `inbox_id`, `status` (`open`/`resolved`/`pending`/`snoozed`), `labels[]`, `meta.sender` (contato), `meta.assignee` (agente), `meta.team`, `contact_inbox.source_id`, `custom_attributes`, `first_reply_created_at`, `waiting_since`, `created_at`, `last_activity_at`, `account`; nos updates, `changed_attributes` |
| `contact_created` / `contact_updated` | `id`, `name`, `phone_number` (E.164), `email`, `identifier`, `custom_attributes`, `additional_attributes`, `account` (sem inbox) |

### 16.3 Identificação

- **Empresa**: `(conexão, account.id, inbox.id)` → `chatwoot_inboxes.empresa_id`. Inbox não mapeado
  → evento guardado com status "inbox não mapeado" e **não** processado (nada é atribuído a empresa errada).
- **Contato**: telefone normalizado (`meta.sender.phone_number`), com `chatwoot_contact_id` guardado.
  Unicidade por **empresa** (a mesma pessoa pode ser cliente de duas empresas — são contatos diferentes).
- **Conversa**: `(conexão, display_id)`.
- **Mensagem**: `(conexão, message.id)`.
- `contact_created/updated` não trazem inbox; como um contato Chatwoot pode falar com várias inboxes,
  **eles só atualizam contatos já conhecidos** (nome/e-mail); a criação acontece via conversa/mensagem.

### 16.4 Recebimento, idempotência e falhas

```text
Chatwoot ──POST──▶ /api/public/hooks/chatwoot/{webhook_token}
   1. acha a conexão pelo token (404 se não existir/inativa)
   2. valida HMAC se a conexão tiver segredo e a verificação estiver ligada (janela de 5 min)
   3. INSERT integracao_eventos ... ON CONFLICT (chave_dedup) DO NOTHING   ← durável, antes de tudo
   4. responde 200 imediatamente
   5. processa (transação no Postgres): conversa → contato → lead → mensagem → marcos do funil
   6. marca processado / erro (com mensagem)
Cloud Scheduler (5 min) ──▶ reprocessa eventos "erro"/"pendente" com backoff (máx. N tentativas)
Cloud Scheduler (15 min) ──▶ reconciliação pela API do Chatwoot (conversas com atividade recente)
```

- **Chave de deduplicação** do evento: `evento:conta:entidade:versão` (ex.:
  `message_created:12:98765`, `conversation_updated:12:431:{updated_at}`); fallback = SHA-256 do corpo.
- **Idempotência em nível de entidade** (mais forte que por evento): tudo é `upsert` por chave natural;
  o **índice único parcial "um lead aberto por contato"** impede dois leads mesmo com eventos
  simultâneos. Reprocessar um evento nunca duplica.
- **Processamento transacional** numa função Postgres (`processar_evento_chatwoot`) ou via conexão
  `postgres` direta — o supabase-js não faz transação.
- **Reconciliação** cobre a ausência de retry do Chatwoot e eventos perdidos em quedas.
- Cloud Run com **1 instância mínima** para não estourar os 5 s em cold start.

### 16.5 Autenticação

1. **Token secreto na URL** por conexão (32 bytes aleatórios; rotacionável) — sempre.
2. **HMAC `X-Chatwoot-Signature`** + janela de timestamp — ligado quando a versão da sua instalação
   assinar corretamente (validar por causa do issue #13809).
3. Opcional para self-hosted: restringir IP de origem.
4. Chamadas do Nexa OS à API do Chatwoot com `api_access_token` de um **usuário técnico dedicado**
   (ex.: "Integração Nexa OS"), guardado no Secret Manager.

### 16.6 Contato × Lead × Conversa (regras propostas)

- Nova conversa (ou primeira mensagem `incoming`) de um contato **sem lead aberto** → cria lead
  `LEAD_RECEBIDO`.
- Contato **com lead aberto** → a conversa/mensagem entra no lead existente.
- Contato cujo último lead foi **encerrado** (ganho/perdido) → novo lead se passaram **X dias**
  (configurável por empresa, ex.: 30); abaixo disso, reabre o anterior **[decisão sua]**.
- Mensagens `activity` e notas privadas não contam como atendimento; `outgoing` de agente conta.
- Marcos de tempo no lead (base dos indicadores, não dependem de alguém mudar status à mão):
  `recebido_em`, `primeira_resposta_em`, `qualificado_em`, `orcamento_em`, `orcamento_aprovado_em`,
  `os_criada_em`, `agendado_em`, `realizado_em`, `faturado_em`, `perdido_em` + motivo.
- **Etapa canônica** (enum igual para todas as empresas) + os **status personalizados** já existentes
  em `config_options` mapeados para ela (o campo `metadata.stage` já existe):

| Status atual (Turbine) | Etapa canônica |
|---|---|
| Novo contato, Aguardando atendimento | LEAD_RECEBIDO |
| Em atendimento | ATENDIMENTO |
| Em negociação | QUALIFICADO |
| Orçamento enviado, Aguardando resposta | ORCAMENTO_PENDENTE |
| Não respondeu / Repescar | SEM_RESPOSTA |
| Agendado | SERVICO_AGENDADO |
| Desistiu | PERDIDO |
| Pós-venda | SERVICO_REALIZADO |

  Etapas avançam automaticamente por fatos do sistema: orçamento vinculado ao lead → ORÇAMENTO;
  `enviado` → PENDENTE; `aprovado` → APROVADO; OS criada → OS_CRIADA; atendimento agendado →
  AGENDADO; concluído → REALIZADO; pagamento → FATURADO; `recusado` → RECUSADO; orçamento sem
  resposta após N dias → EXPIRADO; OS cancelada → CANCELADO.
- **"Sem resposta"** tem dois sentidos que vamos medir separadamente: (a) **empresa não respondeu**
  o lead em X min/h; (b) **cliente parou de responder** depois da última mensagem da empresa.

### 16.7 Endpoints da API do Chatwoot que usaremos

Application API, cabeçalho `api_access_token` **[caminhos conhecidos; confirmar parâmetros na
versão instalada — o site de documentação estava inacessível a partir deste ambiente]**:

| Uso | Endpoint |
|---|---|
| Listar inboxes (tela de mapeamento) | `GET /api/v1/accounts/{account_id}/inboxes` |
| Listar agentes (responsável) | `GET /api/v1/accounts/{account_id}/agents` |
| Reconciliação de conversas | `GET /api/v1/accounts/{account_id}/conversations?status=all&page=N` |
| Detalhe da conversa | `GET /api/v1/accounts/{account_id}/conversations/{display_id}` |
| Mensagens da conversa | `GET /api/v1/accounts/{account_id}/conversations/{display_id}/messages` |
| Contato | `GET /api/v1/accounts/{account_id}/contacts/{id}` |
| Etiquetas | `GET /api/v1/accounts/{account_id}/labels` |
| (Opcional) criar webhook | `POST /api/v1/accounts/{account_id}/webhooks` |
| (Fase futura) escrever etapa no Chatwoot | `POST …/conversations/{id}/labels`, `custom_attributes` |

### 16.8 Múltiplas contas / inboxes

O modelo aceita as duas organizações; a escolha é sua:

- **A — Uma conta Chatwoot "Nexa" com uma inbox de WhatsApp por cliente** (recomendado se os
  clientes não precisam operar o Chatwoot): 1 webhook, 10 atendentes numa conta só, distribuição e
  relatórios centralizados; a inbox identifica a empresa.
- **B — Uma conta por cliente**: isolamento no próprio Chatwoot; 30 webhooks, atendentes membros de
  30 contas.

### 16.9 O que precisa ser configurado manualmente (não dá para inferir do código)

1. Chatwoot **Cloud ou self-hosted**, URL e **versão** instalada.
2. Organização A ou B (acima) e o **mapa inbox → empresa**.
3. Recurso "API e webhooks" habilitado na conta; webhook criado apontando para o Nexa OS com os
   eventos `conversation_created`, `conversation_updated`, `conversation_status_changed`,
   `message_created`, `message_updated`, `contact_created`, `contact_updated`.
4. Usuário técnico no Chatwoot e seu **access token**.
5. WhatsApp de cada cliente conectado ao Chatwoot pela **WhatsApp Business Platform (Cloud API)**:
   Meta Business do cliente (ou da Nexa como parceira), número verificado, token de usuário do sistema.
6. Decidir o destino do **webhook direto atual da Meta** (C4) e verificar a **atribuição de anúncio** (C3).

---

## 17. Stack e infraestrutura recomendadas

| Tema | Recomendação | Motivo |
|---|---|---|
| Framework | **Manter TanStack Start** (não migrar para Next.js agora) | Já é full-stack React com SSR e funções de servidor; migrar ~30 telas e toda a camada de dados é custo sem ganho funcional e alto risco de regressão. Reavaliar só se surgir limitação concreta. |
| Hospedagem | **Cloud Run** (`southamerica-east1`), Nitro preset `node-server`, 1 instância mínima | Barato, escala sozinho, perto dos usuários; sai da dependência do Lovable. |
| Banco | **Manter Postgres no Supabase** (projeto próprio da Nexa, região São Paulo) | O app acessa o banco direto do navegador com RLS e usa Supabase Auth; ir para Cloud SQL exigiria reescrever autenticação e criar uma API para cada tela. Cloud SQL fica como opção futura. |
| Auth | Supabase Auth (convites, sem cadastro aberto) | Já integrado. |
| Segredos | **Secret Manager** | Tokens do Chatwoot, OAuth Google, chaves de job. |
| Jobs | **Cloud Scheduler** → endpoints internos autenticados (OIDC) | Substitui pg_cron + chave pública. Cloud Tasks só se o volume exigir fila. |
| Google Drive/Docs/Agenda | APIs oficiais diretas; **OAuth por empresa** ("Conectar Google" na configuração da empresa), token de renovação criptografado | Cada cliente com sua pasta/agenda/conta. Service account não serve bem: não convida participantes sem Workspace + delegação e não tem cota no "Meu Drive". Escopos a validar: `calendar.events`, `drive.file` (+ Docs) — escopo Drive completo exige verificação cara do Google. |
| Arquivos | Continuar no Google Drive do cliente | Já é o fluxo atual; Cloud Storage só se surgir necessidade. |
| Logs | Cloud Logging + tabela `integracao_eventos` | Rastreabilidade por evento. |
| Geografia | Google Maps (Geocoding/Routes) ou OSRM próprio | Substituir serviços públicos. |
| IA (fase 2) | Gemini via **Vertex AI** | Substitui o gateway do Lovable; o recurso atual de resumo fica desligado até lá. |
| Evitar agora | GKE, Pub/Sub, BigQuery, Firestore, microsserviços | Desnecessários para 30 empresas / 10 atendentes. |

Custo mensal indicativo (ordem de grandeza, a confirmar com o uso real): Cloud Run com 1 instância
mínima ~US$ 15–40; Supabase Pro US$ 25 + uso; Secret Manager/Scheduler/Logging poucos dólares.
Chatwoot e Meta (conversas de WhatsApp) são custos à parte.

## 18. Credenciais e acessos necessários

| Item | Quem fornece | Uso |
|---|---|---|
| Acesso ao projeto Supabase atual (ou dump completo do banco + usuários do Auth) | Você / Lovable Cloud | Migrar dados da Turbine Clean sem perda |
| Novo projeto Supabase da Nexa: URL, chave publicável, **service role**, string de conexão | Nexa | Banco e Auth |
| Projeto Google Cloud (faturamento ativo), permissão para Cloud Run, Secret Manager, Scheduler | Nexa | Hospedagem |
| OAuth Client do Google (tela de consentimento, domínio verificado) | Nexa | Drive/Docs/Agenda por empresa |
| Chatwoot: URL, `account_id`(s), access token do usuário técnico, segredo do webhook, lista de inboxes | Nexa | Integração |
| Meta/WhatsApp Business Platform por cliente (configurado **no Chatwoot**) | Clientes / Nexa | Canal de WhatsApp |
| Domínio (ex.: `app.nexaperformance.com.br`) e DNS | Nexa | URL pública e do webhook |
| Chave de API do Google Maps (se trocarmos Nominatim/OSRM) | Nexa | km e sugestões por CEP |

## 19. Plano de implementação em etapas

| Etapa | Entrega | Critério de aceite |
|---|---|---|
| **1 (esta)** | Análise e arquitetura | Você aprova ou ajusta as decisões da seção 20 |
| **2 — Fundação e isolamento** | Ambiente próprio (Cloud Run + Supabase da Nexa, staging e produção); cópia dos dados da Turbine; Google direto (trocar base da URL + OAuth por empresa, mantendo a lógica); **correções R1–R7**: `empresa_id` explícito, fim do `DEFAULT`, unicidades por empresa, helper de acesso nas server functions, configurações por empresa, cadastro fechado, papéis Nexa, seletor de empresa, provisionamento de empresa; testes das regras de cálculo e de isolamento | Turbine funciona igual à produção atual; uma 2ª empresa de teste opera sem enxergar/afetar a Turbine (teste automatizado) |
| **3 — MVP Chatwoot → Lead** | Tabelas da seção 15; tela de conexão e mapeamento de inboxes; endpoint de webhook; processamento idempotente; log de eventos com reprocessamento; reconciliação; lista de leads e painel mínimo por empresa | Conversa real de WhatsApp aparece como contato + lead na empresa certa; reenvio do mesmo evento não duplica; queda simulada é recuperada pela reconciliação |
| **4 — Funil e indicadores** | Etapa canônica + marcos; vínculos orçamento↔lead↔OS; funções SQL de indicadores; dashboard da empresa (funil completo, conversão, ticket médio, faturamento, custos, margem) | Números batem com contagem manual em um período de teste |
| **5 — Painel Nexa + comissão** | Visão consolidada das empresas; contratos e apurações de comissão (devida/paga/pendente) | Apuração fechada não muda quando o cliente edita dados |
| **6 — Refino operacional** | Escritas críticas transacionais no servidor; geografia própria; Google Sheets → Nexa OS (serviços/preços/parâmetros) se ainda fizer sentido — hoje a tabela de preços e as configurações já cobrem isso dentro do sistema | — |
| **7 — IA (Gemini/Vertex)** | Classificação, resumo, objeções, follow-up; depois atendimento automático | — |

## 20. Decisões

As respostas de 25/09/2026 (Chatwoot Cloud com uma conta, WhatsApp pelo Chatwoot, projeto novo
sem migrar o Lovable Cloud, OAuth Google por empresa, regra da comissão e novo lead após 30 dias)
estão registradas em [`DECISOES.md`](./DECISOES.md), junto com o plano atualizado e o checklist.

## Fontes externas consultadas

- Código-fonte oficial do Chatwoot (branch `develop`, lido em 24/09/2026):
  `app/models/webhook.rb`, `app/listeners/webhook_listener.rb`, `lib/webhooks/trigger.rb`,
  `app/jobs/webhook_job.rb`, `app/presenters/conversations/event_data_presenter.rb`,
  `app/models/message.rb`, `app/models/contact.rb`, `app/models/channel/api.rb` —
  <https://github.com/chatwoot/chatwoot>
- Issue de assinatura de webhook: <https://github.com/chatwoot/chatwoot/issues/13809>
- Guia de webhooks do Chatwoot (resumo via busca; o site estava bloqueado a partir deste ambiente):
  <https://www.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks>
