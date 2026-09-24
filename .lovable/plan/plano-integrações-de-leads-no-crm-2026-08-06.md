# Plano: Integrações de Leads no CRM

## Objetivo
Permitir que leads do Meta Lead Ads, Google Ads (formulários) e formulários próprios do site caiam automaticamente no funil do CRM WhatsApp, sem depender de importação manual. O fluxo será: fonte externa envia lead → webhook valida e normaliza → lead é criado/associado no CRM → aparece na lista de leads com origem e campanha corretas.

## O que será feito

### 1. Banco de dados
Criar a tabela `public.crm_source_integrations` para guardar cada fonte de lead ativa:
- `name` (nome interno, ex: "Formulário Site")
- `source_type` (enum: `meta_lead_ads`, `google_ads`, `custom_form`)
- `webhook_token` (token de validação do endpoint, gerado automaticamente)
- `secret` (segredo opcional para assinatura/HMAC)
- `field_mapping` (JSON: mapeia campos da fonte para os campos do CRM)
- `default_campaign_id` e `default_salesperson_id` (valores padrão quando a fonte não informar)
- `active` (liga/desliga)
- `created_at` / `updated_at`

A tabela terá política de acesso: staff pode gerenciar; anônimo sem acesso. GRANTs e RLS incluídos na mesma migration.

### 2. Endpoint de webhook genérico
Criar `src/routes/api/public/hooks/leads.ts` que recebe POSTs de qualquer fonte configurada.

- URL pública: `/api/public/hooks/leads/:sourceType/:token`
- Valida token ativo e, quando houver, assinatura HMAC ou segredo da fonte.
- Faz parse do payload conforme `source_type`:
  - `meta_lead_ads`: extrai `leadgen_id`, `page_id`, `form_id`, `created_time`, `field_data` (nome, telefone, email, cidade, etc.).
  - `google_ads`: extrai `leadId`, `campaignId`, `gclId`, `userColumnData` (nome, telefone, email, etc.).
  - `custom_form`: espera JSON simples `{ nome, telefone, email, cidade, servico, mensagem, campanha, vendedor }`.
- Normaliza telefone com `normalizePhone` do CRM.
- Se o telefone já existir em `whatsapp_contacts` ou `customers`, vincula o lead existente; senão, cria novo contato e lead.
- Chama a função existente `createLead` (de `src/lib/crm.ts`) para garantir consistência com temperatura, status inicial e follow-up.
- Registra o evento bruto em `crm_webhook_events` (reutilizando a tabela de eventos), com `processing_status` e `payload`.

### 3. Configuração no CRM
Adicionar a rota `src/routes/_authenticated/crm/integracoes.tsx`.

- Lista integrações cadastradas com tipo, nome, status, URL do webhook e ações (editar, desativar, renovar token).
- Formulário para criar/editar integração com campos: nome, tipo, campanha padrão, vendedor padrão, mapeamento de campos e segredo.
- Botão "Copiar URL" com o endpoint pronto para colar no Meta/G Ads.
- Incluir a página no menu lateral em `CRM WhatsApp` como "Integrações de Leads".

### 4. Campanha e atribuição
- Se a fonte informar `campaign_id`/`ad_id` ou `gclId`, tenta cruzar com `crm_campaigns` (external_id) antes de usar a campanha padrão.
- O lead criado terá `source_type` preenchido com o tipo da integração e `campaign_id` resolvido.
- A tela de campanhas (`campanhas.tsx`) continua como controle de investimento; os leads entrados por integração aparecem nos dashboards existentes automaticamente.

### 5. Testes e simulação
- Incluir um painel de "Testar envio" na página de integrações, simulando um POST de cada tipo e criando um lead de teste.
- Reutilizar o mesmo padrão da tela de WhatsApp (status, eventos, reprocessamento).

## Não está no escopo
- Envio de mensagens ativas pelo WhatsApp Business (respostas do atendente). O recebimento continua funcionando como hoje.
- Automação de respostas automáticas no funil. Foco apenas na captação de leads externos.

## Como medir sucesso
- Um POST de teste no endpoint `/api/public/hooks/leads/custom_form/:token` cria um lead visível na lista `crm/leads` em até 5 segundos.
- A URL do webhook pode ser copiada e configurada no Meta Events Manager ou Google Ads sem erro de token.
- Leads duplicados pelo telefone reutilizam o contato e atualizam o lead, em vez de criar infinitos novos.
