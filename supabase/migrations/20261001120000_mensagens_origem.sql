-- =====================================================================================
-- Nexa OS — Mensagens prontas por origem
--
-- Cada empresa cadastra os textos dos seus links de WhatsApp (wa.me/...?text=...) e diz de
-- qual origem (e, se quiser, campanha e serviço) cada um vem. Ao chegar a primeira mensagem, o
-- lead recebe a origem da mensagem cadastrada contida no texto (a mais longa, se houver mais de
-- uma), comparando sem maiúsculas, acentos nem pontuação.
--
-- Ordem da identificação: cliente já cadastrado → caixa do Instagram/Facebook → dados de anúncio
-- → mensagem pronta cadastrada → palavras-chave da origem. A campanha e o serviço da mensagem
-- pronta são gravados mesmo quando a origem vem de uma regra anterior.
-- =====================================================================================

-- ---------------------------------------------------------------- tabela
CREATE TABLE public.mensagens_origem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL DEFAULT private.empresa_ativa() REFERENCES public.empresas(id) ON DELETE CASCADE,
  texto text NOT NULL CHECK (length(trim(private.texto_busca(texto))) > 0),
  sales_origin_id uuid NOT NULL REFERENCES public.config_options(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.crm_campaigns(id) ON DELETE SET NULL,
  servico text,
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mensagens_origem_texto_key ON public.mensagens_origem (empresa_id, private.texto_busca(texto));
CREATE INDEX idx_mensagens_origem_origem ON public.mensagens_origem (sales_origin_id);
CREATE INDEX idx_mensagens_origem_campanha ON public.mensagens_origem (campaign_id);
ALTER TABLE public.mensagens_origem ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mensagens_origem TO authenticated;
GRANT ALL ON public.mensagens_origem TO service_role;
CREATE POLICY mensagens_origem_empresa_ativa ON public.mensagens_origem FOR ALL TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()))
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()));
CREATE TRIGGER trg_mensagens_origem_upd BEFORE UPDATE ON public.mensagens_origem
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_mensagens_origem_valida_empresa BEFORE INSERT OR UPDATE ON public.mensagens_origem
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias(
    'sales_origin_id', 'config_options', 'campaign_id', 'crm_campaigns');

-- A origem precisa ser da lista de origens de venda.
CREATE OR REPLACE FUNCTION private.validar_mensagem_origem()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.config_options
                  WHERE id = NEW.sales_origin_id AND kind = 'sales_origin') THEN
    RAISE EXCEPTION 'A origem escolhida não é uma origem de venda.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_mensagens_origem_valida_origem BEFORE INSERT OR UPDATE ON public.mensagens_origem
  FOR EACH ROW EXECUTE FUNCTION private.validar_mensagem_origem();

-- ---------------------------------------------------------------- identificação
-- SECURITY INVOKER: no processamento do Chatwoot roda como dono da função chamadora; chamada
-- pelo app, o RLS limita as listas à empresa ativa.
CREATE OR REPLACE FUNCTION private.identificar_origem_lead(
  _empresa_id uuid, _texto text, _canal text, _eh_cliente boolean, _atributos jsonb
) RETURNS TABLE (origem uuid, campanha uuid, servico text)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  codigo text;
  txt text := private.texto_busca(_texto);
  anuncio text := lower(coalesce(_atributos::text, ''));
  msg_origem uuid;
  r record;
BEGIN
  IF length(trim(txt)) > 0 THEN
    SELECT m.sales_origin_id, m.campaign_id, m.servico INTO msg_origem, campanha, servico
      FROM public.mensagens_origem m
     WHERE m.empresa_id = _empresa_id AND m.ativo
       AND position(private.texto_busca(m.texto) IN txt) > 0
     ORDER BY length(private.texto_busca(m.texto)) DESC, m.created_at
     LIMIT 1;
  END IF;

  IF _eh_cliente THEN
    codigo := 'cliente_existente';
  ELSIF _canal = 'Channel::Instagram' THEN
    codigo := 'instagram';
  ELSIF _canal = 'Channel::FacebookPage' THEN
    codigo := 'facebook';
  ELSIF anuncio LIKE '%instagram%' THEN
    codigo := 'instagram';
  ELSIF anuncio LIKE '%facebook%' OR anuncio LIKE '%fb.me%' OR anuncio LIKE '%ctwa%' THEN
    codigo := 'facebook';
  END IF;

  IF codigo IS NOT NULL THEN
    origem := (SELECT o.id FROM public.config_options o
                WHERE o.empresa_id = _empresa_id AND o.kind = 'sales_origin' AND o.active
                  AND o.metadata->>'codigo' = codigo
                ORDER BY o.display_order LIMIT 1);
  END IF;
  origem := coalesce(origem, msg_origem);

  IF origem IS NULL AND length(trim(txt)) > 0 THEN
    FOR r IN
      SELECT o.id, o.metadata->'palavras' AS palavras FROM public.config_options o
       WHERE o.empresa_id = _empresa_id AND o.kind = 'sales_origin' AND o.active
         AND jsonb_typeof(o.metadata->'palavras') = 'array'
       ORDER BY o.display_order, o.name
    LOOP
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(r.palavras) w
         WHERE length(trim(private.texto_busca(w))) > 0
           AND position(private.texto_busca(w) IN txt) > 0
      ) THEN
        origem := r.id;
        EXIT;
      END IF;
    END LOOP;
  END IF;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION private.identificar_origem_lead(uuid, text, text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.identificar_origem_lead(uuid, text, text, boolean, jsonb) TO authenticated, service_role;

-- Compatibilidade: só a origem.
CREATE OR REPLACE FUNCTION private.detectar_origem_lead(
  _empresa_id uuid, _texto text, _canal text, _eh_cliente boolean, _atributos jsonb
) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.origem FROM private.identificar_origem_lead(_empresa_id, _texto, _canal, _eh_cliente, _atributos) i;
$$;
REVOKE ALL ON FUNCTION private.detectar_origem_lead(uuid, text, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- processamento do Chatwoot
-- Mesma função, gravando também a campanha e o serviço da mensagem pronta.
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
  ident record;
  texto_inicial text;
  atributos jsonb;
  tipo_msg text;
  msg_id uuid;
  msg_inserida boolean := false;
  anexo_tipo text;
  n int;
BEGIN
  -- Eventos de contato não trazem caixa: só atualizam contatos já conhecidos.
  IF evento IN ('contact_created', 'contact_updated') THEN
    nome := nullif(trim(p->>'name'), '');
    -- O lead aberto acompanha o nome do contato enquanto ninguém o editou à mão
    -- (nome igual ao anterior do contato, ou vazio/"Sem nome").
    UPDATE public.crm_leads l
       SET lead_name = nome
      FROM public.whatsapp_contacts c
     WHERE nome IS NOT NULL
       AND c.chatwoot_contact_id = (p->>'id')::bigint
       AND c.empresa_id IN (SELECT i.empresa_id FROM public.chatwoot_inboxes i WHERE i.conexao_id = _ev.conexao_id)
       AND l.whatsapp_contact_id = c.id AND l.is_open
       AND l.lead_name IS DISTINCT FROM nome
       AND (l.lead_name IN ('', 'Sem nome') OR l.lead_name = c.profile_name);
    UPDATE public.whatsapp_contacts c
       SET profile_name = coalesce(nome, c.profile_name)
     WHERE c.chatwoot_contact_id = (p->>'id')::bigint
       AND c.empresa_id IN (SELECT i.empresa_id FROM public.chatwoot_inboxes i WHERE i.conexao_id = _ev.conexao_id);
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

  -- Dados para identificar a origem: primeira mensagem do cliente e atributos de anúncio.
  texto_inicial := CASE
    WHEN eh_mensagem THEN CASE WHEN tipo_msg = 'incoming' THEN p->>'content' END
    WHEN coalesce(conv->'messages'->0->>'message_type', '') IN ('0', 'incoming') THEN conv->'messages'->0->>'content'
  END;
  atributos := coalesce(conv->'additional_attributes', '{}'::jsonb)
    || coalesce(p->'content_attributes', '{}'::jsonb)
    || coalesce(conv->'messages'->0->'content_attributes', '{}'::jsonb);

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
    SELECT * INTO ident FROM private.identificar_origem_lead(emp, texto_inicial, conv->>'channel',
      cliente_id IS NOT NULL, atributos);

    INSERT INTO public.crm_leads (empresa_id, whatsapp_contact_id, customer_id, first_contact_date,
      lead_name, phone, normalized_phone, temperature, status_id, sales_origin_id, source_type,
      referral_data, is_open, last_interaction_at, summary_source, origem_automatica,
      campaign_id, service_interest)
    VALUES (emp, contato_id, cliente_id, (quando AT TIME ZONE 'America/Sao_Paulo')::date,
      coalesce(nome, 'Sem nome'), coalesce(pessoa->>'phone_number', telefone), telefone, 'FRIO',
      status_novo, ident.origem, 'Chatwoot',
      jsonb_strip_nulls(jsonb_build_object(
        'chatwoot_conversation_id', conversa_display,
        'inbox_id', _ev.inbox_id,
        'additional_attributes', conv->'additional_attributes')),
      true, quando, 'Automático', ident.origem IS NOT NULL,
      ident.campanha, ident.servico)
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

  -- Lead sem origem (nem automática nem manual): nova tentativa com a mensagem do cliente.
  IF NOT lead_criado AND texto_inicial IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.crm_leads WHERE id = lead_id AND sales_origin_id IS NULL) THEN
    SELECT * INTO ident FROM private.identificar_origem_lead(emp, texto_inicial, conv->>'channel',
      false, atributos);
    IF ident.origem IS NOT NULL THEN
      UPDATE public.crm_leads
         SET sales_origin_id = ident.origem, origem_automatica = true,
             campaign_id = coalesce(campaign_id, ident.campanha),
             service_interest = coalesce(nullif(service_interest, ''), ident.servico)
       WHERE id = lead_id AND sales_origin_id IS NULL;
    END IF;
  END IF;

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

-- ---------------------------------------------------------------- ações do app
-- Testa um texto: qual origem, campanha e serviço seriam identificados na empresa ativa.
CREATE OR REPLACE FUNCTION public.testar_origem_mensagem(_texto text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'origem', (SELECT name FROM public.config_options WHERE id = i.origem),
    'campanha', (SELECT campaign_name FROM public.crm_campaigns WHERE id = i.campanha),
    'servico', i.servico)
    FROM private.identificar_origem_lead((SELECT private.empresa_ativa()), _texto, NULL, false, '{}'::jsonb) i;
$$;
REVOKE ALL ON FUNCTION public.testar_origem_mensagem(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.testar_origem_mensagem(text) TO authenticated;

-- Leads da empresa ativa sem origem: usa a primeira mensagem recebida que identifique uma.
-- Origem escolhida à mão nunca é trocada (só leads sem origem são alterados).
CREATE OR REPLACE FUNCTION public.reaplicar_origem_leads()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  n int;
BEGIN
  WITH alvo AS (
    SELECT l.id, a.origem, a.campanha, a.servico
      FROM public.crm_leads l
      CROSS JOIN LATERAL (
        SELECT i.origem, i.campanha, i.servico
          FROM public.whatsapp_messages m
          CROSS JOIN LATERAL private.identificar_origem_lead(l.empresa_id, m.text_content, NULL,
            l.customer_id IS NOT NULL, coalesce(l.referral_data->'additional_attributes', '{}'::jsonb)) i
         WHERE m.crm_lead_id = l.id AND m.direction = 'Recebida' AND i.origem IS NOT NULL
         ORDER BY m.message_timestamp
         LIMIT 1) a
     WHERE l.sales_origin_id IS NULL AND l.empresa_id = (SELECT private.empresa_ativa())
  )
  UPDATE public.crm_leads l
     SET sales_origin_id = a.origem, origem_automatica = true,
         campaign_id = coalesce(l.campaign_id, a.campanha),
         service_interest = coalesce(nullif(l.service_interest, ''), a.servico)
    FROM alvo a
   WHERE l.id = a.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.reaplicar_origem_leads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reaplicar_origem_leads() TO authenticated;
