-- =====================================================================================
-- Nexa OS — Etapa 3: integração Chatwoot → Nexa OS → Lead
--
-- Fluxo: webhook do Chatwoot → receber_evento_chatwoot (registro durável e idempotente)
--        → processar_evento_chatwoot (uma transação: contato, conversa, lead, mensagem).
--
-- Regras:
--  * A empresa é identificada pela caixa de entrada (chatwoot_inboxes). Caixa não mapeada:
--    o evento fica guardado como 'inbox_nao_mapeado' e pode ser reprocessado depois.
--  * O mesmo evento enviado duas vezes não cria nada novo (chave de deduplicação).
--  * Reprocessar um evento nunca duplica: tudo é gravado por chave natural.
--  * Um contato tem no máximo um lead aberto; depois de encerrado, só gera lead novo após
--    N dias (app_settings.crm_novo_lead_apos_dias, padrão 30) — decisão D6.
--  * Tudo é gravado com empresa_id explícito (a rotina roda com a chave de serviço).
-- =====================================================================================

-- ---------------------------------------------------------------- utilitários
CREATE OR REPLACE FUNCTION private.normalizar_telefone(_valor text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d = '' THEN NULL
    WHEN length(d) <= 11 THEN '55' || d
    ELSE d
  END
  FROM (SELECT regexp_replace(coalesce(_valor, ''), '\D', '', 'g') AS d) s;
$$;

-- Datas do Chatwoot chegam como número (epoch, às vezes com fração) ou texto ISO 8601.
CREATE OR REPLACE FUNCTION private.chatwoot_data(_valor jsonb)
RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF _valor IS NULL OR jsonb_typeof(_valor) = 'null' THEN
    RETURN NULL;
  ELSIF jsonb_typeof(_valor) = 'number' THEN
    IF (_valor #>> '{}')::numeric <= 0 THEN RETURN NULL; END IF;
    RETURN to_timestamp((_valor #>> '{}')::double precision);
  ELSIF jsonb_typeof(_valor) = 'string' THEN
    IF (_valor #>> '{}') ~ '^\d+(\.\d+)?$' THEN
      RETURN to_timestamp((_valor #>> '{}')::double precision);
    END IF;
    RETURN (_valor #>> '{}')::timestamptz;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------- conexões (plataforma Nexa)
CREATE TABLE public.chatwoot_conexoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  base_url text NOT NULL DEFAULT 'https://app.chatwoot.com',
  account_id bigint NOT NULL,
  -- Segredo que vai na URL do webhook (64 caracteres hexadecimais aleatórios).
  webhook_token text NOT NULL UNIQUE
    DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  verificar_assinatura boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  ultimo_evento_em timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_url, account_id)
);
ALTER TABLE public.chatwoot_conexoes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chatwoot_conexoes TO authenticated;
GRANT ALL ON public.chatwoot_conexoes TO service_role;
CREATE POLICY chatwoot_conexoes_nexa ON public.chatwoot_conexoes FOR ALL TO authenticated
  USING ((SELECT private.is_nexa_admin())) WITH CHECK ((SELECT private.is_nexa_admin()));
CREATE TRIGGER trg_chatwoot_conexoes_upd BEFORE UPDATE ON public.chatwoot_conexoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Segredos ficam numa tabela sem acesso pelo app: só a chave de serviço lê.
CREATE TABLE public.chatwoot_conexao_segredos (
  conexao_id uuid PRIMARY KEY REFERENCES public.chatwoot_conexoes(id) ON DELETE CASCADE,
  webhook_secret text,
  api_token text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chatwoot_conexao_segredos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chatwoot_conexao_segredos FROM anon, authenticated;
GRANT ALL ON public.chatwoot_conexao_segredos TO service_role;

-- ---------------------------------------------------------------- caixas de entrada → empresa
CREATE TABLE public.chatwoot_inboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conexao_id uuid NOT NULL REFERENCES public.chatwoot_conexoes(id) ON DELETE CASCADE,
  inbox_id bigint NOT NULL,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome text,
  canal text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conexao_id, inbox_id)
);
CREATE INDEX idx_chatwoot_inboxes_empresa ON public.chatwoot_inboxes (empresa_id);
ALTER TABLE public.chatwoot_inboxes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chatwoot_inboxes TO authenticated;
GRANT ALL ON public.chatwoot_inboxes TO service_role;
CREATE POLICY chatwoot_inboxes_nexa ON public.chatwoot_inboxes FOR ALL TO authenticated
  USING ((SELECT private.is_nexa_admin())) WITH CHECK ((SELECT private.is_nexa_admin()));
CREATE POLICY chatwoot_inboxes_empresa_select ON public.chatwoot_inboxes FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));

-- ---------------------------------------------------------------- registro dos eventos
CREATE TABLE public.integracao_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provedor text NOT NULL DEFAULT 'chatwoot',
  conexao_id uuid REFERENCES public.chatwoot_conexoes(id) ON DELETE SET NULL,
  delivery_id text,
  evento text NOT NULL,
  chave_dedup text NOT NULL UNIQUE,
  account_id bigint,
  inbox_id bigint,
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'recebido'
    CHECK (status IN ('recebido', 'processado', 'ignorado', 'inbox_nao_mapeado', 'erro')),
  tentativas integer NOT NULL DEFAULT 0,
  erro text,
  resultado jsonb,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz
);
CREATE INDEX idx_integracao_eventos_status ON public.integracao_eventos (status, recebido_em);
CREATE INDEX idx_integracao_eventos_empresa ON public.integracao_eventos (empresa_id, recebido_em DESC);
CREATE INDEX idx_integracao_eventos_recebido ON public.integracao_eventos (recebido_em DESC);
ALTER TABLE public.integracao_eventos ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.integracao_eventos TO authenticated;
GRANT ALL ON public.integracao_eventos TO service_role;
CREATE POLICY integracao_eventos_nexa ON public.integracao_eventos FOR SELECT TO authenticated
  USING ((SELECT private.is_nexa_admin()));
CREATE POLICY integracao_eventos_empresa ON public.integracao_eventos FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));

-- ---------------------------------------------------------------- conversas
CREATE TABLE public.conversas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL DEFAULT private.empresa_ativa() REFERENCES public.empresas(id),
  conexao_id uuid NOT NULL REFERENCES public.chatwoot_conexoes(id) ON DELETE CASCADE,
  chatwoot_conversation_id bigint NOT NULL,
  inbox_id bigint,
  whatsapp_contact_id uuid REFERENCES public.whatsapp_contacts(id) ON DELETE SET NULL,
  crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  status text,
  responsavel_id bigint,
  responsavel_nome text,
  time_nome text,
  etiquetas text[] NOT NULL DEFAULT '{}',
  primeira_resposta_em timestamptz,
  aguardando_desde timestamptz,
  criada_em timestamptz,
  ultima_atividade_em timestamptz,
  atualizado_chatwoot_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conexao_id, chatwoot_conversation_id)
);
CREATE INDEX idx_conversas_empresa ON public.conversas (empresa_id, ultima_atividade_em DESC);
CREATE INDEX idx_conversas_lead ON public.conversas (crm_lead_id);
CREATE INDEX idx_conversas_contato ON public.conversas (whatsapp_contact_id);
ALTER TABLE public.conversas ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversas TO authenticated;
GRANT ALL ON public.conversas TO service_role;
CREATE POLICY conversas_empresa_ativa ON public.conversas FOR ALL TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()))
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()));
CREATE TRIGGER trg_conversas_upd BEFORE UPDATE ON public.conversas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_conversas_valida_empresa BEFORE INSERT OR UPDATE ON public.conversas
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias(
    'crm_lead_id', 'crm_leads', 'whatsapp_contact_id', 'whatsapp_contacts');

-- ---------------------------------------------------------------- colunas novas
ALTER TABLE public.whatsapp_contacts
  ADD COLUMN chatwoot_contact_id bigint,
  ADD COLUMN origem text NOT NULL DEFAULT 'whatsapp';
CREATE UNIQUE INDEX whatsapp_contacts_chatwoot_key
  ON public.whatsapp_contacts (empresa_id, chatwoot_contact_id) WHERE chatwoot_contact_id IS NOT NULL;

ALTER TABLE public.whatsapp_messages
  ADD COLUMN conversa_id uuid REFERENCES public.conversas(id) ON DELETE SET NULL,
  ADD COLUMN chatwoot_message_id bigint,
  ADD COLUMN remetente_tipo text,
  ADD COLUMN privada boolean NOT NULL DEFAULT false,
  ADD COLUMN origem text NOT NULL DEFAULT 'whatsapp';
CREATE UNIQUE INDEX whatsapp_messages_chatwoot_key
  ON public.whatsapp_messages (empresa_id, chatwoot_message_id) WHERE chatwoot_message_id IS NOT NULL;
CREATE INDEX whatsapp_messages_conversa_idx ON public.whatsapp_messages (conversa_id, message_timestamp);

DROP TRIGGER trg_whatsapp_messages_valida_empresa ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_messages_valida_empresa BEFORE INSERT OR UPDATE ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias(
    'conversa_id', 'conversas', 'crm_lead_id', 'crm_leads', 'whatsapp_contact_id', 'whatsapp_contacts');

-- Marco do funil: primeira resposta de um atendente ao lead.
ALTER TABLE public.crm_leads ADD COLUMN primeira_resposta_em timestamptz;

-- ---------------------------------------------------------------- deduplicação
CREATE OR REPLACE FUNCTION private.chatwoot_chave_dedup(_payload jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  evento text := coalesce(_payload->>'event', 'desconhecido');
  conta text := coalesce(_payload->'account'->>'id', '?');
  hash text := md5(_payload::text);
BEGIN
  IF evento = 'message_created' AND _payload ? 'id' THEN
    RETURN format('chatwoot:%s:%s:%s', conta, evento, _payload->>'id');
  ELSIF evento LIKE 'conversation_%' AND _payload ? 'id' THEN
    RETURN format('chatwoot:%s:%s:%s:%s', conta, evento, _payload->>'id',
      coalesce(_payload->>'updated_at', hash));
  ELSIF _payload ? 'id' THEN
    RETURN format('chatwoot:%s:%s:%s:%s', conta, evento, _payload->>'id', hash);
  END IF;
  RETURN format('chatwoot:%s:%s:%s', conta, evento, hash);
END $$;

-- ---------------------------------------------------------------- aplicação de um evento
-- Faz o trabalho de um evento e devolve o resultado. Chamada por processar_evento_chatwoot,
-- que cuida da transação e do registro de erro.
CREATE OR REPLACE FUNCTION private.aplicar_evento_chatwoot(_ev public.integracao_eventos)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p jsonb := _ev.payload;
  evento text := _ev.evento;
  eh_mensagem boolean := evento IN ('message_created', 'message_updated');
  emp uuid;
  conv jsonb;
  pessoa jsonb;
  conversa_display bigint;
  contato_chatwoot bigint;
  telefone text;
  nome text;
  quando timestamptz;
  contato_id uuid;
  contato_criado boolean := false;
  cliente_id uuid;
  conversa_row public.conversas;
  lead_id uuid;
  lead_criado boolean := false;
  dias int;
  status_novo uuid;
  origem_whats uuid;
  tipo_msg text;
  msg_id uuid;
  msg_inserida boolean := false;
  anexo_tipo text;
  n int;
BEGIN
  -- Eventos de contato não trazem caixa: só atualizam contatos já conhecidos.
  IF evento IN ('contact_created', 'contact_updated') THEN
    UPDATE public.whatsapp_contacts c
       SET profile_name = coalesce(nullif(p->>'name', ''), c.profile_name)
      FROM public.chatwoot_inboxes i
     WHERE i.conexao_id = _ev.conexao_id
       AND c.empresa_id = i.empresa_id
       AND c.chatwoot_contact_id = (p->>'id')::bigint;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN jsonb_build_object('status', CASE WHEN n > 0 THEN 'processado' ELSE 'ignorado' END,
                              'contatos_atualizados', n);
  END IF;

  IF evento NOT IN ('conversation_created', 'conversation_updated', 'conversation_status_changed',
                    'message_created', 'message_updated') THEN
    RETURN jsonb_build_object('status', 'ignorado', 'motivo', 'evento não utilizado');
  END IF;

  IF _ev.inbox_id IS NULL THEN
    RETURN jsonb_build_object('status', 'ignorado', 'motivo', 'evento sem caixa de entrada');
  END IF;

  SELECT empresa_id INTO emp FROM public.chatwoot_inboxes
   WHERE conexao_id = _ev.conexao_id AND inbox_id = _ev.inbox_id AND ativo;
  IF emp IS NULL THEN
    RETURN jsonb_build_object('status', 'inbox_nao_mapeado', 'inbox_id', _ev.inbox_id);
  END IF;

  -- Mensagens de atividade (sistema) não entram no histórico comercial.
  IF eh_mensagem THEN
    tipo_msg := CASE p->>'message_type'
      WHEN '0' THEN 'incoming' WHEN '1' THEN 'outgoing' WHEN '2' THEN 'activity' WHEN '3' THEN 'template'
      ELSE p->>'message_type' END;
    IF tipo_msg = 'activity' THEN
      RETURN jsonb_build_object('status', 'ignorado', 'motivo', 'mensagem de atividade', 'empresa_id', emp);
    END IF;
  END IF;

  conv := CASE WHEN eh_mensagem THEN p->'conversation' ELSE p END;
  conversa_display := (conv->>'id')::bigint;
  IF conversa_display IS NULL THEN
    RAISE EXCEPTION 'evento sem identificador da conversa';
  END IF;

  -- Contato: quem está do outro lado da conversa (nunca o atendente).
  pessoa := conv->'meta'->'sender';
  IF (pessoa IS NULL OR jsonb_typeof(pessoa) <> 'object') AND eh_mensagem
     AND coalesce(p->'sender'->>'type', 'contact') = 'contact' THEN
    pessoa := p->'sender';
  END IF;
  contato_chatwoot := (pessoa->>'id')::bigint;
  nome := nullif(trim(pessoa->>'name'), '');
  telefone := coalesce(
    private.normalizar_telefone(pessoa->>'phone_number'),
    private.normalizar_telefone(conv->'contact_inbox'->>'source_id'),
    CASE WHEN contato_chatwoot IS NOT NULL THEN 'chatwoot:' || contato_chatwoot END);
  IF telefone IS NULL THEN
    RAISE EXCEPTION 'evento sem contato identificável';
  END IF;

  quando := coalesce(
    CASE WHEN eh_mensagem THEN private.chatwoot_data(p->'created_at') END,
    private.chatwoot_data(conv->'last_activity_at'),
    private.chatwoot_data(conv->'timestamp'),
    now());

  -- Serializa o processamento do mesmo contato (evita dois leads em eventos simultâneos).
  PERFORM pg_advisory_xact_lock(hashtextextended(emp::text || ':' || telefone, 0));

  SELECT id INTO contato_id FROM public.whatsapp_contacts
   WHERE empresa_id = emp
     AND ((contato_chatwoot IS NOT NULL AND chatwoot_contact_id = contato_chatwoot)
          OR normalized_phone = telefone)
   ORDER BY (chatwoot_contact_id IS NOT DISTINCT FROM contato_chatwoot) DESC
   LIMIT 1;

  SELECT id INTO cliente_id FROM public.customers
   WHERE empresa_id = emp
     AND regexp_replace(phone, '\D', '', 'g') IN (telefone, substring(telefone FROM 3))
   LIMIT 1;

  IF contato_id IS NULL THEN
    INSERT INTO public.whatsapp_contacts (empresa_id, normalized_phone, display_phone, wa_id,
      profile_name, chatwoot_contact_id, origem, first_contact_at, last_contact_at,
      current_customer_id, is_existing_customer)
    VALUES (emp, telefone, pessoa->>'phone_number', nullif(conv->'contact_inbox'->>'source_id', ''),
      nome, contato_chatwoot, 'chatwoot', quando, quando, cliente_id, cliente_id IS NOT NULL)
    RETURNING id INTO contato_id;
    contato_criado := true;
  ELSE
    UPDATE public.whatsapp_contacts
       SET chatwoot_contact_id = coalesce(chatwoot_contact_id, contato_chatwoot),
           profile_name = coalesce(nome, profile_name),
           last_contact_at = greatest(last_contact_at, quando),
           current_customer_id = coalesce(current_customer_id, cliente_id),
           is_existing_customer = is_existing_customer OR cliente_id IS NOT NULL
     WHERE id = contato_id;
  END IF;

  -- Conversa: grava o estado mais recente (eventos podem chegar fora de ordem).
  INSERT INTO public.conversas AS c (empresa_id, conexao_id, chatwoot_conversation_id, inbox_id,
    whatsapp_contact_id, status, responsavel_id, responsavel_nome, time_nome, etiquetas,
    primeira_resposta_em, aguardando_desde, criada_em, ultima_atividade_em, atualizado_chatwoot_em)
  VALUES (emp, _ev.conexao_id, conversa_display, _ev.inbox_id, contato_id,
    conv->>'status',
    (conv->'meta'->'assignee'->>'id')::bigint,
    conv->'meta'->'assignee'->>'name',
    conv->'meta'->'team'->>'name',
    coalesce(ARRAY(SELECT jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(conv->'labels') = 'array' THEN conv->'labels' ELSE '[]'::jsonb END)), '{}'),
    private.chatwoot_data(conv->'first_reply_created_at'),
    private.chatwoot_data(conv->'waiting_since'),
    coalesce(private.chatwoot_data(conv->'created_at'), quando),
    quando,
    private.chatwoot_data(conv->'updated_at'))
  ON CONFLICT (conexao_id, chatwoot_conversation_id) DO UPDATE SET
    whatsapp_contact_id = EXCLUDED.whatsapp_contact_id,
    status = CASE WHEN c.atualizado_chatwoot_em IS NULL OR EXCLUDED.atualizado_chatwoot_em IS NULL
                    OR EXCLUDED.atualizado_chatwoot_em >= c.atualizado_chatwoot_em
                  THEN coalesce(EXCLUDED.status, c.status) ELSE c.status END,
    responsavel_id = CASE WHEN c.atualizado_chatwoot_em IS NULL OR EXCLUDED.atualizado_chatwoot_em IS NULL
                            OR EXCLUDED.atualizado_chatwoot_em >= c.atualizado_chatwoot_em
                          THEN EXCLUDED.responsavel_id ELSE c.responsavel_id END,
    responsavel_nome = CASE WHEN c.atualizado_chatwoot_em IS NULL OR EXCLUDED.atualizado_chatwoot_em IS NULL
                              OR EXCLUDED.atualizado_chatwoot_em >= c.atualizado_chatwoot_em
                            THEN EXCLUDED.responsavel_nome ELSE c.responsavel_nome END,
    time_nome = CASE WHEN c.atualizado_chatwoot_em IS NULL OR EXCLUDED.atualizado_chatwoot_em IS NULL
                       OR EXCLUDED.atualizado_chatwoot_em >= c.atualizado_chatwoot_em
                     THEN EXCLUDED.time_nome ELSE c.time_nome END,
    etiquetas = CASE WHEN c.atualizado_chatwoot_em IS NULL OR EXCLUDED.atualizado_chatwoot_em IS NULL
                       OR EXCLUDED.atualizado_chatwoot_em >= c.atualizado_chatwoot_em
                     THEN EXCLUDED.etiquetas ELSE c.etiquetas END,
    primeira_resposta_em = coalesce(c.primeira_resposta_em, EXCLUDED.primeira_resposta_em),
    aguardando_desde = CASE WHEN c.atualizado_chatwoot_em IS NULL OR EXCLUDED.atualizado_chatwoot_em IS NULL
                              OR EXCLUDED.atualizado_chatwoot_em >= c.atualizado_chatwoot_em
                            THEN EXCLUDED.aguardando_desde ELSE c.aguardando_desde END,
    criada_em = least(c.criada_em, EXCLUDED.criada_em),
    ultima_atividade_em = greatest(c.ultima_atividade_em, EXCLUDED.ultima_atividade_em),
    atualizado_chatwoot_em = greatest(c.atualizado_chatwoot_em, EXCLUDED.atualizado_chatwoot_em)
  RETURNING * INTO conversa_row;

  -- Lead: o da conversa; senão o aberto do contato; senão o último encerrado há menos de
  -- N dias; senão um novo.
  IF conversa_row.crm_lead_id IS NOT NULL THEN
    SELECT id INTO lead_id FROM public.crm_leads WHERE id = conversa_row.crm_lead_id;
  END IF;
  IF lead_id IS NULL THEN
    SELECT id INTO lead_id FROM public.crm_leads
     WHERE empresa_id = emp AND whatsapp_contact_id = contato_id AND is_open
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF lead_id IS NULL THEN
    SELECT coalesce((value #>> '{}')::int, 30) INTO dias FROM public.app_settings
     WHERE empresa_id = emp AND key = 'crm_novo_lead_apos_dias';
    dias := coalesce(dias, 30);
    SELECT id INTO lead_id FROM public.crm_leads
     WHERE empresa_id = emp AND whatsapp_contact_id = contato_id AND NOT is_open
       AND coalesce(closed_at, updated_at) >= quando - make_interval(days => dias)
     ORDER BY coalesce(closed_at, updated_at) DESC LIMIT 1;
  END IF;
  IF lead_id IS NULL THEN
    SELECT id INTO status_novo FROM public.config_options
     WHERE empresa_id = emp AND kind = 'crm_status' AND name = 'Novo contato' LIMIT 1;
    SELECT id INTO origem_whats FROM public.config_options
     WHERE empresa_id = emp AND kind = 'sales_origin' AND name ILIKE '%whats%' AND active LIMIT 1;

    INSERT INTO public.crm_leads (empresa_id, whatsapp_contact_id, customer_id, first_contact_date,
      lead_name, phone, normalized_phone, temperature, status_id, sales_origin_id, source_type,
      referral_data, is_open, last_interaction_at, summary_source)
    VALUES (emp, contato_id, cliente_id, (quando AT TIME ZONE 'America/Sao_Paulo')::date,
      coalesce(nome, 'Sem nome'), coalesce(pessoa->>'phone_number', telefone), telefone, 'FRIO',
      status_novo, origem_whats, 'Chatwoot',
      jsonb_strip_nulls(jsonb_build_object(
        'chatwoot_conversation_id', conversa_display,
        'inbox_id', _ev.inbox_id,
        'additional_attributes', conv->'additional_attributes')),
      true, quando, 'Automático')
    RETURNING id INTO lead_id;
    lead_criado := true;

    INSERT INTO public.crm_status_history (empresa_id, crm_lead_id, new_status_id, new_status_name,
      change_source, notes)
    VALUES (emp, lead_id, status_novo, 'Novo contato', 'Chatwoot',
      'Lead criado automaticamente a partir de uma conversa do Chatwoot.');
  END IF;

  IF conversa_row.crm_lead_id IS DISTINCT FROM lead_id THEN
    UPDATE public.conversas SET crm_lead_id = lead_id WHERE id = conversa_row.id;
  END IF;

  UPDATE public.crm_leads
     SET last_interaction_at = greatest(coalesce(last_interaction_at, quando), quando)
   WHERE id = lead_id;

  -- Mensagem.
  IF eh_mensagem THEN
    anexo_tipo := p->'attachments'->0->>'file_type';
    INSERT INTO public.whatsapp_messages AS m (empresa_id, whatsapp_contact_id, crm_lead_id, conversa_id,
      chatwoot_message_id, whatsapp_message_id, direction, message_type, text_content,
      message_timestamp, remetente_tipo, privada, origem, raw_event_reference)
    VALUES (emp, contato_id, lead_id, conversa_row.id,
      (p->>'id')::bigint, nullif(p->>'source_id', ''),
      CASE WHEN tipo_msg = 'incoming' THEN 'Recebida' ELSE 'Enviada' END,
      CASE anexo_tipo
        WHEN 'image' THEN 'Imagem' WHEN 'audio' THEN 'Áudio' WHEN 'video' THEN 'Vídeo'
        WHEN 'file' THEN 'Documento' WHEN 'location' THEN 'Localização' WHEN 'contact' THEN 'Contato'
        WHEN 'sticker' THEN 'Figurinha'
        ELSE CASE WHEN anexo_tipo IS NULL THEN 'Texto' ELSE 'Outro' END END,
      p->>'content', quando,
      coalesce(p->'sender'->>'type', CASE WHEN tipo_msg = 'incoming' THEN 'contact' ELSE 'user' END),
      coalesce((p->>'private')::boolean, false), 'chatwoot', _ev.id::text)
    ON CONFLICT (empresa_id, chatwoot_message_id) WHERE chatwoot_message_id IS NOT NULL
    DO UPDATE SET text_content = EXCLUDED.text_content
    RETURNING m.id, (m.xmax = 0) INTO msg_id, msg_inserida;

    IF msg_inserida THEN
      IF tipo_msg = 'incoming' THEN
        UPDATE public.whatsapp_contacts
           SET total_inbound_messages = total_inbound_messages + 1,
               last_message_at = greatest(coalesce(last_message_at, quando), quando)
         WHERE id = contato_id;
      ELSIF NOT coalesce((p->>'private')::boolean, false) THEN
        UPDATE public.whatsapp_contacts
           SET total_outbound_messages = total_outbound_messages + 1
         WHERE id = contato_id;
      END IF;
    END IF;

    -- Primeira resposta: mensagem de saída, não privada, de atendente ou robô.
    IF tipo_msg = 'outgoing' AND NOT coalesce((p->>'private')::boolean, false) THEN
      UPDATE public.crm_leads SET primeira_resposta_em = quando
       WHERE id = lead_id AND (primeira_resposta_em IS NULL OR primeira_resposta_em > quando);
      UPDATE public.conversas SET primeira_resposta_em = quando
       WHERE id = conversa_row.id AND (primeira_resposta_em IS NULL OR primeira_resposta_em > quando);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', 'processado',
    'empresa_id', emp,
    'contato_id', contato_id,
    'contato_criado', contato_criado,
    'conversa_id', conversa_row.id,
    'lead_id', lead_id,
    'lead_criado', lead_criado,
    'mensagem_id', msg_id,
    'mensagem_inserida', msg_inserida);
END $$;

-- Processa um evento registrado: aplica numa subtransação; em caso de erro, desfaz o que foi
-- feito e deixa o evento marcado como 'erro' para reprocessar.
CREATE OR REPLACE FUNCTION private.processar_evento_chatwoot(_evento_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev public.integracao_eventos;
  res jsonb;
BEGIN
  SELECT * INTO ev FROM public.integracao_eventos WHERE id = _evento_id FOR UPDATE;
  IF ev.id IS NULL THEN
    RAISE EXCEPTION 'evento % não encontrado', _evento_id;
  END IF;
  IF ev.status IN ('processado', 'ignorado') THEN
    RETURN jsonb_build_object('evento_id', ev.id, 'status', ev.status, 'ja_processado', true);
  END IF;

  BEGIN
    res := private.aplicar_evento_chatwoot(ev);
    UPDATE public.integracao_eventos
       SET status = res->>'status',
           empresa_id = coalesce((res->>'empresa_id')::uuid, empresa_id),
           resultado = res,
           erro = NULL,
           tentativas = tentativas + 1,
           processado_em = now()
     WHERE id = ev.id;
  EXCEPTION WHEN others THEN
    res := jsonb_build_object('status', 'erro', 'erro', SQLERRM);
    UPDATE public.integracao_eventos
       SET status = 'erro', erro = left(SQLERRM, 800), tentativas = tentativas + 1,
           processado_em = now()
     WHERE id = ev.id;
  END;

  RETURN res || jsonb_build_object('evento_id', ev.id);
END $$;

-- Entrada do webhook: identifica a conexão pelo token, confere a conta, registra o evento
-- (idempotente) e processa.
CREATE OR REPLACE FUNCTION private.receber_evento_chatwoot(_token text, _delivery_id text, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cx public.chatwoot_conexoes;
  evento text := _payload->>'event';
  conta bigint;
  inbox bigint;
  chave text;
  ev_id uuid;
BEGIN
  SELECT * INTO cx FROM public.chatwoot_conexoes WHERE webhook_token = _token AND ativo;
  IF cx.id IS NULL THEN
    RAISE EXCEPTION 'conexao_invalida' USING ERRCODE = '28000';
  END IF;
  IF evento IS NULL THEN
    RAISE EXCEPTION 'payload sem evento' USING ERRCODE = '22023';
  END IF;

  conta := (_payload->'account'->>'id')::bigint;
  IF conta IS NOT NULL AND conta <> cx.account_id THEN
    RAISE EXCEPTION 'conta_divergente' USING ERRCODE = '28000';
  END IF;

  inbox := coalesce(
    (_payload->'inbox'->>'id')::bigint,
    (_payload->>'inbox_id')::bigint,
    (_payload->'conversation'->>'inbox_id')::bigint);
  chave := private.chatwoot_chave_dedup(_payload);

  INSERT INTO public.integracao_eventos (provedor, conexao_id, delivery_id, evento, chave_dedup,
    account_id, inbox_id, payload)
  VALUES ('chatwoot', cx.id, nullif(_delivery_id, ''), evento, chave, coalesce(conta, cx.account_id),
    inbox, _payload)
  ON CONFLICT (chave_dedup) DO NOTHING
  RETURNING id INTO ev_id;

  UPDATE public.chatwoot_conexoes SET ultimo_evento_em = now() WHERE id = cx.id;

  IF ev_id IS NULL THEN
    SELECT id INTO ev_id FROM public.integracao_eventos WHERE chave_dedup = chave;
    RETURN jsonb_build_object('evento_id', ev_id, 'duplicado', true);
  END IF;

  RETURN private.processar_evento_chatwoot(ev_id) || jsonb_build_object('duplicado', false);
END $$;

-- Reprocessa eventos pendentes (erro, caixa não mapeada ou não processados). Usado pelo
-- botão da tela da Nexa e pela tarefa periódica.
CREATE OR REPLACE FUNCTION private.reprocessar_eventos_chatwoot(_limite int DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev record;
  res jsonb;
  total int := 0;
  processados int := 0;
BEGIN
  IF NOT (private.is_nexa_admin() OR coalesce(auth.jwt()->>'role', '') = 'service_role') THEN
    RAISE EXCEPTION 'apenas a Nexa reprocessa eventos';
  END IF;
  FOR ev IN
    SELECT id FROM public.integracao_eventos
     WHERE provedor = 'chatwoot' AND status IN ('recebido', 'erro', 'inbox_nao_mapeado')
       AND tentativas < 20
     ORDER BY recebido_em
     LIMIT greatest(coalesce(_limite, 100), 1)
  LOOP
    res := private.processar_evento_chatwoot(ev.id);
    total := total + 1;
    IF res->>'status' = 'processado' THEN processados := processados + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('verificados', total, 'processados', processados);
END $$;

-- Segredos da conexão: só a Nexa grava; ninguém lê pelo app.
CREATE OR REPLACE FUNCTION private.definir_segredos_chatwoot(_conexao_id uuid, _webhook_secret text, _api_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'apenas a Nexa altera a conexão';
  END IF;
  INSERT INTO public.chatwoot_conexao_segredos (conexao_id, webhook_secret, api_token, updated_at)
  VALUES (_conexao_id, nullif(_webhook_secret, ''), nullif(_api_token, ''), now())
  ON CONFLICT (conexao_id) DO UPDATE SET
    webhook_secret = coalesce(nullif(EXCLUDED.webhook_secret, ''), chatwoot_conexao_segredos.webhook_secret),
    api_token = coalesce(nullif(EXCLUDED.api_token, ''), chatwoot_conexao_segredos.api_token),
    updated_at = now();
END $$;

-- Resumo das conexões para a tela da Nexa (indica se há segredos, sem revelá-los).
CREATE OR REPLACE FUNCTION private.chatwoot_conexoes_resumo()
RETURNS TABLE (id uuid, nome text, base_url text, account_id bigint, webhook_token text,
  verificar_assinatura boolean, ativo boolean, ultimo_evento_em timestamptz,
  tem_segredo boolean, tem_token_api boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.nome, c.base_url, c.account_id, c.webhook_token, c.verificar_assinatura, c.ativo,
         c.ultimo_evento_em, s.webhook_secret IS NOT NULL, s.api_token IS NOT NULL
    FROM public.chatwoot_conexoes c
    LEFT JOIN public.chatwoot_conexao_segredos s ON s.conexao_id = c.id
   WHERE private.is_nexa_admin()
   ORDER BY c.created_at;
$$;

REVOKE ALL ON FUNCTION private.aplicar_evento_chatwoot(public.integracao_eventos) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.processar_evento_chatwoot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.receber_evento_chatwoot(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.reprocessar_eventos_chatwoot(int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.definir_segredos_chatwoot(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.chatwoot_conexoes_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.receber_evento_chatwoot(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.processar_evento_chatwoot(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.reprocessar_eventos_chatwoot(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.definir_segredos_chatwoot(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.chatwoot_conexoes_resumo() TO authenticated, service_role;

-- Funções expostas pela API.
CREATE OR REPLACE FUNCTION public.receber_evento_chatwoot(_token text, _delivery_id text, _payload jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = public, private AS $$
  SELECT private.receber_evento_chatwoot(_token, _delivery_id, _payload);
$$;
CREATE OR REPLACE FUNCTION public.reprocessar_eventos_chatwoot(_limite int DEFAULT 100)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = public, private AS $$
  SELECT private.reprocessar_eventos_chatwoot(_limite);
$$;
CREATE OR REPLACE FUNCTION public.definir_segredos_chatwoot(_conexao_id uuid, _webhook_secret text DEFAULT NULL, _api_token text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public, private AS $$
  SELECT private.definir_segredos_chatwoot(_conexao_id, _webhook_secret, _api_token);
$$;
CREATE OR REPLACE FUNCTION public.chatwoot_conexoes_resumo()
RETURNS TABLE (id uuid, nome text, base_url text, account_id bigint, webhook_token text,
  verificar_assinatura boolean, ativo boolean, ultimo_evento_em timestamptz,
  tem_segredo boolean, tem_token_api boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, private AS $$
  SELECT * FROM private.chatwoot_conexoes_resumo();
$$;

REVOKE ALL ON FUNCTION public.receber_evento_chatwoot(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reprocessar_eventos_chatwoot(int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.definir_segredos_chatwoot(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chatwoot_conexoes_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receber_evento_chatwoot(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reprocessar_eventos_chatwoot(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.definir_segredos_chatwoot(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chatwoot_conexoes_resumo() TO authenticated, service_role;
