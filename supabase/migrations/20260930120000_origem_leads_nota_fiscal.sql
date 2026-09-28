-- =====================================================================================
-- Nexa OS — Origem dos leads e emissão de nota fiscal
--
--  * Origem = de onde o lead veio (Google, Instagram, Facebook, Indicação, Blog, Cliente
--    existente / Recorrência, Outra origem). O canal de atendimento (Chatwoot/WhatsApp) não é
--    origem: fica em crm_leads.source_type.
--  * Identificação automática ao criar o lead (Chatwoot):
--      1. telefone de cliente já cadastrado → Cliente existente / Recorrência;
--      2. caixa do Instagram/Facebook ou dados de anúncio "clique para WhatsApp" → Instagram/Facebook;
--      3. palavras-chave na primeira mensagem do cliente (config_options.metadata.palavras,
--         editáveis por empresa) — ex.: links de WhatsApp com texto "Vim pelo Google".
--    Sem identificação, fica em branco ("Não identificada") para definição manual.
--  * O lead aberto acompanha o nome do contato quando ele é editado no Chatwoot.
--  * Nota fiscal: situação "Solicitada", anexo do PDF (Storage, pasta por empresa) e modelo
--    da mensagem por empresa (app_settings.invoice_message_template).
-- =====================================================================================

-- ---------------------------------------------------------------- origens padrão
UPDATE public.config_options SET name = 'Cliente existente / Recorrência'
 WHERE kind = 'sales_origin' AND name = 'Cliente recorrente';
UPDATE public.config_options SET name = 'Outra origem'
 WHERE kind = 'sales_origin' AND name = 'Outros';

WITH padrao (codigo, nome, ordem, palavras) AS (
  VALUES
    ('google', 'Google', 1, '["vim pelo google", "pelo google", "google"]'::jsonb),
    ('instagram', 'Instagram', 2, '["instagram"]'::jsonb),
    ('facebook', 'Facebook', 3, '["facebook"]'::jsonb),
    ('indicacao', 'Indicação', 4, '["indicação", "me indicou", "me indicaram", "indicado por", "indicada por", "indicaram vocês", "indicou vocês"]'::jsonb),
    ('blog', 'Blog', 5, '["blog"]'::jsonb),
    ('cliente_existente', 'Cliente existente / Recorrência', 6, '[]'::jsonb),
    ('outra', 'Outra origem', 7, '[]'::jsonb)
), faltando AS (
  INSERT INTO public.config_options (empresa_id, kind, name, display_order, metadata)
  SELECT e.id, 'sales_origin', p.nome, p.ordem, '{}'::jsonb
    FROM public.empresas e CROSS JOIN padrao p
   WHERE NOT EXISTS (SELECT 1 FROM public.config_options c
                      WHERE c.empresa_id = e.id AND c.kind = 'sales_origin' AND c.name = p.nome)
  RETURNING id
)
SELECT count(*) FROM faltando;

UPDATE public.config_options c
   SET display_order = p.ordem,
       metadata = c.metadata || jsonb_build_object('codigo', p.codigo, 'palavras', p.palavras)
  FROM (VALUES
    ('google', 'Google', 1, '["vim pelo google", "pelo google", "google"]'::jsonb),
    ('instagram', 'Instagram', 2, '["instagram"]'::jsonb),
    ('facebook', 'Facebook', 3, '["facebook"]'::jsonb),
    ('indicacao', 'Indicação', 4, '["indicação", "me indicou", "me indicaram", "indicado por", "indicada por", "indicaram vocês", "indicou vocês"]'::jsonb),
    ('blog', 'Blog', 5, '["blog"]'::jsonb),
    ('cliente_existente', 'Cliente existente / Recorrência', 6, '[]'::jsonb),
    ('outra', 'Outra origem', 7, '[]'::jsonb)
  ) AS p (codigo, nome, ordem, palavras)
 WHERE c.kind = 'sales_origin' AND c.name = p.nome;

ALTER TABLE public.crm_leads ADD COLUMN origem_automatica boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- identificação da origem
-- Texto em minúsculas, sem acentos e só com letras/números separados por um espaço.
CREATE OR REPLACE FUNCTION private.texto_busca(_texto text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ' ' || trim(regexp_replace(
    translate(lower(coalesce(_texto, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
    '[^a-z0-9]+', ' ', 'g')) || ' ';
$$;

CREATE OR REPLACE FUNCTION private.detectar_origem_lead(
  _empresa_id uuid, _texto text, _canal text, _eh_cliente boolean, _atributos jsonb
) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  codigo text;
  txt text := private.texto_busca(_texto);
  anuncio text := lower(coalesce(_atributos::text, ''));
  r record;
BEGIN
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
    RETURN (SELECT id FROM public.config_options
             WHERE empresa_id = _empresa_id AND kind = 'sales_origin' AND active
               AND metadata->>'codigo' = codigo
             ORDER BY display_order LIMIT 1);
  END IF;

  IF length(trim(txt)) = 0 THEN
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT id, metadata->'palavras' AS palavras FROM public.config_options
     WHERE empresa_id = _empresa_id AND kind = 'sales_origin' AND active
       AND jsonb_typeof(metadata->'palavras') = 'array'
     ORDER BY display_order, name
  LOOP
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(r.palavras) w
       WHERE length(trim(private.texto_busca(w))) > 0
         AND position(private.texto_busca(w) IN txt) > 0
    ) THEN
      RETURN r.id;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.detectar_origem_lead(uuid, text, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- processamento do Chatwoot
-- Mesma função da Etapa 3, com a identificação da origem e o nome do lead.
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
  origem uuid;
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
    origem := private.detectar_origem_lead(emp, texto_inicial, conv->>'channel',
      cliente_id IS NOT NULL, atributos);

    INSERT INTO public.crm_leads (empresa_id, whatsapp_contact_id, customer_id, first_contact_date,
      lead_name, phone, normalized_phone, temperature, status_id, sales_origin_id, source_type,
      referral_data, is_open, last_interaction_at, summary_source, origem_automatica)
    VALUES (emp, contato_id, cliente_id, (quando AT TIME ZONE 'America/Sao_Paulo')::date,
      coalesce(nome, 'Sem nome'), coalesce(pessoa->>'phone_number', telefone), telefone, 'FRIO',
      status_novo, origem, 'Chatwoot',
      jsonb_strip_nulls(jsonb_build_object(
        'chatwoot_conversation_id', conversa_display,
        'inbox_id', _ev.inbox_id,
        'additional_attributes', conv->'additional_attributes')),
      true, quando, 'Automático', origem IS NOT NULL)
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
    origem := private.detectar_origem_lead(emp, texto_inicial, conv->>'channel', false, atributos);
    IF origem IS NOT NULL THEN
      UPDATE public.crm_leads SET sales_origin_id = origem, origem_automatica = true
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

-- ---------------------------------------------------------------- indicadores
-- Origem sem identificação aparece como "Não identificada" (antes caía no canal).
CREATE OR REPLACE FUNCTION public.indicadores_funil(_de date, _ate date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH coorte AS (
    SELECT l.*, public.etapa(l) AS etapa_atual,
           EXISTS (SELECT 1 FROM public.conversas c WHERE c.crm_lead_id = l.id) AS tem_conversa
      FROM public.crm_leads l
     WHERE l.first_contact_date BETWEEN _de AND _ate
  ),
  resposta AS (
    SELECT extract(epoch FROM (primeira_resposta_em - created_at)) / 60 AS minutos
      FROM coorte WHERE tem_conversa AND primeira_resposta_em IS NOT NULL
  ),
  os_coorte AS (
    SELECT DISTINCT w.id, w.total_gross_value
      FROM coorte l JOIN public.work_orders w ON w.id = l.linked_work_order_id
     WHERE w.deleted_at IS NULL AND w.status IS DISTINCT FROM 'Cancelada'
  ),
  orcado AS (
    -- Por lead, o orçamento aprovado mais recente; sem aprovado, o mais recente.
    SELECT DISTINCT ON (q.crm_lead_id) q.total
      FROM public.quotes q JOIN coorte l ON l.id = q.crm_lead_id
     ORDER BY q.crm_lead_id, (q.status IN ('aprovado', 'convertido')) DESC, q.created_at DESC
  ),
  q_periodo AS (
    SELECT * FROM public.quotes
     WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _de AND _ate
  ),
  os_periodo AS (
    SELECT * FROM public.work_orders
     WHERE sale_date BETWEEN _de AND _ate AND deleted_at IS NULL AND status IS DISTINCT FROM 'Cancelada'
  ),
  pag_periodo AS (
    SELECT * FROM public.payments
     WHERE payment_date BETWEEN _de AND _ate AND is_active AND payment_status = 'Pago'
  ),
  origens AS (
    SELECT coalesce(o.name, 'Não identificada') AS origem,
           count(*) AS leads,
           count(*) FILTER (WHERE l.orcamento_em IS NOT NULL) AS orcamentos,
           count(*) FILTER (WHERE l.os_criada_em IS NOT NULL) AS vendas,
           coalesce(sum(w.total_gross_value) FILTER (WHERE w.deleted_at IS NULL
             AND w.status IS DISTINCT FROM 'Cancelada'), 0) AS vendido
      FROM coorte l
      LEFT JOIN public.config_options o ON o.id = l.sales_origin_id
      LEFT JOIN public.work_orders w ON w.id = l.linked_work_order_id
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'periodo', jsonb_build_object('de', _de, 'ate', _ate),
    'funil', (SELECT jsonb_build_object(
        'leads', count(*),
        'atendidos', count(*) FILTER (WHERE primeira_resposta_em IS NOT NULL
                                        OR etapa_atual NOT IN ('novo', 'encerrado', 'perdido')),
        'orcamento', count(*) FILTER (WHERE orcamento_em IS NOT NULL),
        'orcamento_enviado', count(*) FILTER (WHERE orcamento_enviado_em IS NOT NULL),
        'orcamento_aprovado', count(*) FILTER (WHERE orcamento_aprovado_em IS NOT NULL OR os_criada_em IS NOT NULL),
        'os_criada', count(*) FILTER (WHERE os_criada_em IS NOT NULL),
        'agendado', count(*) FILTER (WHERE agendado_em IS NOT NULL),
        'realizado', count(*) FILTER (WHERE realizado_em IS NOT NULL),
        'faturado', count(*) FILTER (WHERE faturado_em IS NOT NULL),
        'perdidos', count(*) FILTER (WHERE perdido_em IS NOT NULL AND os_criada_em IS NULL),
        'abertos', count(*) FILTER (WHERE is_open))
      FROM coorte),
    'etapas', (SELECT coalesce(jsonb_object_agg(etapa_atual, n), '{}'::jsonb)
                 FROM (SELECT etapa_atual, count(*) AS n FROM coorte GROUP BY 1) e),
    'atendimento', (SELECT jsonb_build_object(
        'conversas', count(*) FILTER (WHERE tem_conversa),
        'respondidos', count(*) FILTER (WHERE tem_conversa AND primeira_resposta_em IS NOT NULL),
        'sem_resposta', count(*) FILTER (WHERE tem_conversa AND primeira_resposta_em IS NULL),
        'primeira_resposta_mediana_min', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY minutos)::numeric, 1) FROM resposta),
        'primeira_resposta_p90_min', (SELECT round(percentile_cont(0.9) WITHIN GROUP (ORDER BY minutos)::numeric, 1) FROM resposta))
      FROM coorte),
    'valores', jsonb_build_object(
        'orcado', (SELECT coalesce(sum(total), 0) FROM orcado),
        'vendido', (SELECT coalesce(sum(total_gross_value), 0) FROM os_coorte),
        'recebido', (SELECT coalesce(sum(p.gross_amount), 0) FROM public.payments p
                      WHERE p.work_order_id IN (SELECT id FROM os_coorte) AND p.is_active AND p.payment_status = 'Pago')),
    'periodo_geral', jsonb_build_object(
        'orcamentos', (SELECT count(*) FROM q_periodo),
        'orcamentos_enviados', (SELECT count(*) FROM q_periodo WHERE status IN ('enviado', 'aprovado', 'recusado', 'convertido')),
        'orcamentos_aprovados', (SELECT count(*) FROM q_periodo WHERE status IN ('aprovado', 'convertido')),
        'orcamentos_recusados', (SELECT count(*) FROM q_periodo WHERE status = 'recusado'),
        'valor_aprovado', (SELECT coalesce(sum(total), 0) FROM q_periodo WHERE status IN ('aprovado', 'convertido')),
        'lucro_medio_aprovado_pct', (SELECT round(avg(lucro_percentual), 1) FROM q_periodo WHERE status IN ('aprovado', 'convertido')),
        'os', (SELECT count(*) FROM os_periodo),
        'vendido', (SELECT coalesce(sum(total_gross_value), 0) FROM os_periodo),
        'ticket_medio', (SELECT round(avg(total_gross_value), 2) FROM os_periodo),
        'recebido', (SELECT coalesce(sum(gross_amount), 0) FROM pag_periodo),
        'recebido_liquido', (SELECT coalesce(sum(net_amount), 0) FROM pag_periodo)),
    'origens', (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.leads DESC, o.origem), '[]'::jsonb) FROM origens o)
  );
$$;

-- ---------------------------------------------------------------- link da conversa
-- Campo calculado (select=...,url_chatwoot): leva o atendente direto à conversa no Chatwoot.
-- SECURITY DEFINER só para ler endereço e número da conta (as empresas não leem a conexão).
CREATE OR REPLACE FUNCTION public.url_chatwoot(public.conversas)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rtrim(c.base_url, '/') || '/app/accounts/' || c.account_id || '/conversations/'
         || $1.chatwoot_conversation_id
    FROM public.chatwoot_conexoes c WHERE c.id = $1.conexao_id;
$$;
REVOKE ALL ON FUNCTION public.url_chatwoot(public.conversas) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.url_chatwoot(public.conversas) TO authenticated, service_role;

-- ---------------------------------------------------------------- nota fiscal
ALTER TABLE public.invoice_tasks
  ADD COLUMN solicitada_em timestamptz,
  ADD COLUMN arquivo_path text,
  ADD COLUMN arquivo_nome text;

INSERT INTO public.app_settings (empresa_id, key, value)
SELECT e.id, 'invoice_message_template', to_jsonb(
  E'Nota fiscal — {{nome_cliente}}\nCPF/CNPJ: {{cpf_cnpj}}\nE-mail: {{email}}\nData do serviço: {{data_servico}}\nForma de pagamento: {{forma_pagamento}}\nValor: {{valor}}\nOS: {{numero_os}}'::text)
  FROM public.empresas e
ON CONFLICT (empresa_id, key) DO NOTHING;

-- Arquivos das notas no Supabase Storage: pasta = id da empresa; só quem tem acesso à empresa
-- lê e grava. (O bloco só roda onde existe o Storage — no Supabase; o banco local de testes não tem.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('notas-fiscais', 'notas-fiscais', false, 10485760,
            ARRAY['application/pdf', 'image/png', 'image/jpeg', 'text/xml', 'application/xml'])
    ON CONFLICT (id) DO NOTHING;

    EXECUTE $p$CREATE POLICY notas_fiscais_select ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'notas-fiscais'
             AND (storage.foldername(name))[1] IN (SELECT private.empresas_do_usuario((SELECT auth.uid()))::text))$p$;
    EXECUTE $p$CREATE POLICY notas_fiscais_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'notas-fiscais'
             AND (storage.foldername(name))[1] IN (SELECT private.empresas_do_usuario((SELECT auth.uid()))::text))$p$;
    EXECUTE $p$CREATE POLICY notas_fiscais_update ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'notas-fiscais'
             AND (storage.foldername(name))[1] IN (SELECT private.empresas_do_usuario((SELECT auth.uid()))::text))$p$;
    EXECUTE $p$CREATE POLICY notas_fiscais_delete ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'notas-fiscais'
             AND (storage.foldername(name))[1] IN (SELECT private.empresas_do_usuario((SELECT auth.uid()))::text))$p$;
  END IF;
END $$;
