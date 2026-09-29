-- =====================================================================================
-- Nexa OS — Leads novos × reativação
--
-- Lead que o CLIENTE chamou primeiro (anúncio, site, indicação...) é "receptivo": é o que mede
-- a captação (Google, orgânico etc.). Lead que a EMPRESA chamou primeiro (retorno de 6 meses da
-- higienização, 1 ano da impermeabilização, leads antigos) é "ativo" (reativação): tem funil
-- próprio (chamados → responderam → orçamento → venda) e não entra nos números de captação.
--
--  * crm_leads.entrada: definida pela primeira mensagem (não privada) da conversa do Chatwoot
--    ligada ao lead; eventos fora de ordem são corrigidos (vale a mais antiga). Pode ser trocada
--    à mão (entrada_manual), e aí o automático não mexe mais.
--  * crm_leads.respondeu_em: primeira mensagem do cliente (para "responderam" na reativação).
--  * Origem automática só em lead receptivo (a resposta a uma reativação não é origem).
--  * indicadores_funil(de, ate, entrada): 'receptivo' (padrão), 'ativo' ou 'todos'.
-- =====================================================================================

ALTER TABLE public.crm_leads
  ADD COLUMN entrada text NOT NULL DEFAULT 'receptivo' CHECK (entrada IN ('receptivo', 'ativo')),
  ADD COLUMN entrada_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN primeira_mensagem_em timestamptz,
  ADD COLUMN respondeu_em timestamptz;
CREATE INDEX idx_crm_leads_empresa_entrada ON public.crm_leads (empresa_id, entrada, first_contact_date);

-- ---------------------------------------------------------------- classificação pelas mensagens
CREATE OR REPLACE FUNCTION private.lead_entrada_por_mensagem()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.crm_leads l
     SET entrada = CASE
           WHEN l.entrada_manual THEN l.entrada
           WHEN l.primeira_mensagem_em IS NULL OR NEW.message_timestamp < l.primeira_mensagem_em
             THEN CASE WHEN NEW.direction = 'Enviada' THEN 'ativo' ELSE 'receptivo' END
           ELSE l.entrada END,
         primeira_mensagem_em = least(coalesce(l.primeira_mensagem_em, NEW.message_timestamp),
                                      NEW.message_timestamp),
         respondeu_em = CASE WHEN NEW.direction = 'Recebida'
                             THEN least(coalesce(l.respondeu_em, NEW.message_timestamp), NEW.message_timestamp)
                             ELSE l.respondeu_em END
   WHERE l.id = NEW.crm_lead_id AND l.empresa_id = NEW.empresa_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.lead_entrada_por_mensagem() FROM PUBLIC, anon, authenticated;

-- Só mensagens do Chatwoot (registros manuais na tela do lead não definem quem começou).
CREATE TRIGGER trg_whatsapp_messages_entrada AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW WHEN (NEW.crm_lead_id IS NOT NULL AND NOT NEW.privada AND NEW.origem = 'chatwoot')
  EXECUTE FUNCTION private.lead_entrada_por_mensagem();

-- Leads que já existem.
WITH primeiras AS (
  SELECT m.crm_lead_id,
         (array_agg(m.direction ORDER BY m.message_timestamp, m.created_at))[1] AS direcao,
         min(m.message_timestamp) AS primeira,
         min(m.message_timestamp) FILTER (WHERE m.direction = 'Recebida') AS resposta
    FROM public.whatsapp_messages m
   WHERE m.crm_lead_id IS NOT NULL AND NOT m.privada AND m.origem = 'chatwoot'
   GROUP BY m.crm_lead_id
)
UPDATE public.crm_leads l
   SET entrada = CASE WHEN p.direcao = 'Enviada' THEN 'ativo' ELSE 'receptivo' END,
       primeira_mensagem_em = p.primeira,
       respondeu_em = p.resposta
  FROM primeiras p
 WHERE p.crm_lead_id = l.id;

-- Origem automática que tenha sido tirada da resposta a uma reativação não vale.
UPDATE public.crm_leads
   SET sales_origin_id = NULL, campaign_id = NULL, origem_automatica = false
 WHERE entrada = 'ativo' AND origem_automatica AND sales_origin_id IS NOT NULL;

-- ---------------------------------------------------------------- origem só em lead receptivo
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
  -- (Só em lead que o cliente começou: em reativação, a resposta do cliente não indica origem.)
  IF NOT lead_criado AND texto_inicial IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.crm_leads
                  WHERE id = lead_id AND sales_origin_id IS NULL AND entrada = 'receptivo') THEN
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
     WHERE l.sales_origin_id IS NULL AND l.entrada = 'receptivo'
       AND l.empresa_id = (SELECT private.empresa_ativa())
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

-- ---------------------------------------------------------------- indicadores por tipo de entrada
DROP FUNCTION public.indicadores_funil(date, date);
CREATE FUNCTION public.indicadores_funil(_de date, _ate date, _entrada text DEFAULT 'receptivo')
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH coorte AS (
    SELECT l.*, public.etapa(l) AS etapa_atual,
           EXISTS (SELECT 1 FROM public.conversas c WHERE c.crm_lead_id = l.id) AS tem_conversa
      FROM public.crm_leads l
     WHERE l.first_contact_date BETWEEN _de AND _ate
       AND (_entrada = 'todos' OR l.entrada = _entrada)
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
    -- Reativação: em vez da origem (não há anúncio), separa clientes de leads antigos.
    SELECT CASE WHEN l.entrada = 'ativo'
                THEN CASE WHEN l.customer_id IS NOT NULL THEN 'Cliente (retorno)' ELSE 'Lead antigo' END
                ELSE coalesce(o.name, 'Não identificada') END AS origem,
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
    'entrada', _entrada,
    -- Quantos leads de cada tipo chegaram no período (para as abas da tela).
    'entradas', (SELECT jsonb_build_object(
        'receptivo', count(*) FILTER (WHERE entrada = 'receptivo'),
        'ativo', count(*) FILTER (WHERE entrada = 'ativo'))
      FROM public.crm_leads WHERE first_contact_date BETWEEN _de AND _ate),
    'funil', (SELECT jsonb_build_object(
        'leads', count(*),
        'responderam', count(*) FILTER (WHERE respondeu_em IS NOT NULL),
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
REVOKE ALL ON FUNCTION public.indicadores_funil(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.indicadores_funil(date, date, text) TO authenticated, service_role;
