-- Configuração por empresa (parte 2): funções que usavam nomes e dias fixos da Turbine.
-- Trocadas só nos trechos fixos; o resto é igual ao que estava em produção.

CREATE OR REPLACE FUNCTION private.mkt_proximo_horario(_emp uuid, _desde timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg public.mkt_configuracoes := private.mkt_config(_emp);
  local timestamp := _desde AT TIME ZONE 'America/Sao_Paulo';
  dia date := local::date;
BEGIN
  IF extract(isodow FROM dia)::smallint = ANY (cfg.dias_disparo) AND extract(hour FROM local) < cfg.hora_limite THEN
    RETURN greatest(_desde, (dia + make_time(cfg.hora_disparo, 0, 0))::timestamp AT TIME ZONE 'America/Sao_Paulo');
  END IF;
  dia := private.mkt_proximo_dia_util(dia + 1, cfg.dias_disparo);
  RETURN (dia + make_time(cfg.hora_disparo, 0, 0))::timestamp AT TIME ZONE 'America/Sao_Paulo';
END $function$;

CREATE OR REPLACE FUNCTION public.mkt_reservar_envios(_limite integer, _agora timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(envio_id uuid, empresa_id uuid, campanha_id uuid, lote_id uuid, contato_id uuid, normalized_phone text, nome text, primeiro_nome text, template_nome text, variante_sn boolean, idioma text, condicao_texto text, condicao_pct numeric, etiqueta text, grupo text, whatsapp_contact_id uuid, chatwoot_contact_id bigint, conversa_chatwoot_id bigint, conversa_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  agora timestamptz := coalesce(_agora, now());
  hora int := extract(hour FROM coalesce(_agora, now()) AT TIME ZONE 'America/Sao_Paulo')::int;
  dia int := extract(isodow FROM coalesce(_agora, now()) AT TIME ZONE 'America/Sao_Paulo')::int;
BEGIN
  -- Quem saiu (opt-out) depois da preparação não recebe.
  UPDATE public.mkt_envios e SET status = 'cancelado', erro = 'opt-out'
    FROM public.mkt_contatos c
   WHERE c.id = e.contato_id AND e.status IN ('pendente', 'manual') AND c.optout_em IS NOT NULL;
  -- Contato interno da equipe nunca recebe envio de cliente (campanha, gatilho ou promoção).
  UPDATE public.mkt_envios e SET status = 'cancelado', erro = 'contato interno da equipe'
    FROM public.mkt_contatos c
   WHERE c.id = e.contato_id AND e.status IN ('pendente', 'manual')
     AND private.contato_interno(c.empresa_id, c.normalized_phone);
  -- Envio interrompido (servidor caiu no meio): não reenviar às cegas; fica como erro para conferir.
  UPDATE public.mkt_envios SET status = 'erro', erro = 'envio interrompido: confira no Chatwoot'
   WHERE status = 'enviando' AND reservado_em < now() - interval '15 minutes';

  IF hora < 8 OR hora >= 21 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH escolhidos AS (
    SELECT e.id
      FROM public.mkt_envios e
      JOIN public.mkt_lotes l ON l.id = e.lote_id
      JOIN public.mkt_campanhas k ON k.id = e.campanha_id
      JOIN public.mkt_configuracoes cfg ON cfg.empresa_id = e.empresa_id
     WHERE e.status = 'pendente' AND e.agendado_para <= agora
       AND l.status IN ('aprovado', 'enviando')
       AND hora < cfg.hora_limite
       AND ((k.tipo = 'calendario' AND k.status IN ('aprovada', 'enviando') AND cfg.disparo_ligado
             AND dia = ANY (cfg.dias_disparo) AND hora >= cfg.hora_disparo)
         OR (k.tipo = 'promocao' AND k.status IN ('aprovada', 'enviando') AND cfg.disparo_ligado
             AND hora >= 9)
         OR (k.tipo = 'gatilho' AND hora >= 9
             AND ((k.gatilho = 'C1' AND cfg.gatilho_c1_ligado)
               OR (k.gatilho = 'C2' AND cfg.gatilho_c2_ligado)
               OR (k.gatilho IN ('C3', 'C3L') AND cfg.gatilho_c3_ligado))))
     ORDER BY e.agendado_para
     LIMIT greatest(_limite, 0)
     FOR UPDATE OF e SKIP LOCKED
  ), reservados AS (
    UPDATE public.mkt_envios e SET status = 'enviando', reservado_em = now()
      FROM escolhidos x WHERE e.id = x.id
    RETURNING e.*
  ), lotes AS (
    UPDATE public.mkt_lotes l SET status = 'enviando', iniciado_em = coalesce(l.iniciado_em, now())
     WHERE l.id IN (SELECT r.lote_id FROM reservados r) AND l.status = 'aprovado'
    RETURNING l.id
  ), campanhas AS (
    UPDATE public.mkt_campanhas k SET status = 'enviando'
     WHERE k.id IN (SELECT r.campanha_id FROM reservados r) AND k.status = 'aprovada'
    RETURNING k.id
  )
  SELECT r.id, r.empresa_id, r.campanha_id, r.lote_id, r.contato_id, c.normalized_phone, c.nome,
         c.primeiro_nome, r.template_nome, r.variante_sn, cfg.template_idioma, k.condicao_texto,
         k.condicao_pct, l.etiqueta_chatwoot, r.grupo, w.id, w.chatwoot_contact_id,
         cv.chatwoot_conversation_id, cv.status
    FROM reservados r
    JOIN public.mkt_contatos c ON c.id = r.contato_id
    JOIN public.mkt_campanhas k ON k.id = r.campanha_id
    JOIN public.mkt_lotes l ON l.id = r.lote_id
    JOIN public.mkt_configuracoes cfg ON cfg.empresa_id = r.empresa_id
    LEFT JOIN LATERAL (
      SELECT wc.id, wc.chatwoot_contact_id FROM public.whatsapp_contacts wc
       WHERE wc.empresa_id = r.empresa_id
         AND private.telefone_chave(wc.normalized_phone) = private.telefone_chave(c.normalized_phone)
       ORDER BY wc.last_message_at DESC NULLS LAST LIMIT 1
    ) w ON true
    LEFT JOIN LATERAL (
      SELECT v.chatwoot_conversation_id, v.status FROM public.conversas v
       WHERE v.whatsapp_contact_id = w.id AND v.empresa_id = r.empresa_id
       ORDER BY v.ultima_atividade_em DESC NULLS LAST LIMIT 1
    ) cv ON true
   ORDER BY r.agendado_para;
END $function$;

-- ================================================================ 4. gatilhos e contatos
CREATE OR REPLACE FUNCTION private.mkt_campanha_gatilho(_emp uuid, _gatilho text, _mes date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  id_campanha uuid;
  meses text[] := ARRAY['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  rotulo text := CASE _gatilho WHEN 'C1' THEN 'Pós-venda (C1)' WHEN 'C2' THEN 'Higienização 6 meses (C2)'
                               WHEN 'C3' THEN 'Impermeabilização 13º mês (C3)' ELSE 'Lembrete 13º mês (C3)' END;
BEGIN
  SELECT id INTO id_campanha FROM public.mkt_campanhas
   WHERE empresa_id = _emp AND tipo = 'gatilho' AND gatilho = _gatilho AND mes_ref = _mes;
  IF id_campanha IS NULL THEN
    INSERT INTO public.mkt_campanhas (empresa_id, nome, tipo, mes_ref, tema, gatilho, template_nome, status,
      custo_msg_estimado, grupos)
    VALUES (_emp, rotulo || ' — ' || meses[extract(month FROM _mes)::int] || '/' || to_char(_mes, 'YY'),
      'gatilho', _mes, rotulo, _gatilho,
      private.mkt_modelo(_emp, CASE _gatilho WHEN 'C1' THEN 'posvenda' WHEN 'C2' THEN 'higienizacao_6m' WHEN 'C3' THEN 'imper_13m' ELSE 'imper_13m_lembrete' END),
      'enviando', (private.mkt_config(_emp)).custo_msg_estimado,
      ARRAY[CASE _gatilho WHEN 'C3L' THEN 'C3' ELSE _gatilho END])
    ON CONFLICT (empresa_id, gatilho, mes_ref) WHERE tipo = 'gatilho' DO NOTHING
    RETURNING id INTO id_campanha;
    IF id_campanha IS NULL THEN
      SELECT id INTO id_campanha FROM public.mkt_campanhas
       WHERE empresa_id = _emp AND tipo = 'gatilho' AND gatilho = _gatilho AND mes_ref = _mes;
    END IF;
  END IF;
  RETURN id_campanha;
END $function$;

CREATE OR REPLACE FUNCTION private.mkt_contatos_normalizar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  NEW.normalized_phone := private.normalizar_telefone(NEW.normalized_phone);
  IF NEW.normalized_phone IS NULL OR NEW.normalized_phone !~ '^55[1-9][0-9][0-9]{8,9}$' THEN
    RAISE EXCEPTION 'mkt_contatos: telefone inválido (%)', NEW.normalized_phone USING ERRCODE = 'check_violation';
  END IF;
  NEW.nome := nullif(btrim(NEW.nome), '');
  NEW.primeiro_nome := private.mkt_primeiro_nome(NEW.nome);
  -- Palavra do nome da própria empresa não é nome de cliente (ex.: contato salvo como "Turbine").
  IF NEW.primeiro_nome IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.empresas e
        WHERE e.id = NEW.empresa_id
          AND lower(NEW.primeiro_nome) = ANY (regexp_split_to_array(lower(e.nome), '[^[:alnum:]à-öø-ÿ]+'))) THEN
    NEW.primeiro_nome := NULL;
  END IF;
  RETURN NEW;
END $function$;

-- ================================================================ 5. empresa nova
CREATE OR REPLACE FUNCTION private.provisionar_empresa(_nome text, _cnpj text DEFAULT NULL::text, _telefone text DEFAULT NULL::text, _percentual_comissao numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  nova uuid;
  modelo uuid;
  pct numeric;
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'apenas a Nexa cadastra empresas';
  END IF;
  IF _nome IS NULL OR length(trim(_nome)) < 2 THEN
    RAISE EXCEPTION 'informe o nome da empresa';
  END IF;

  SELECT (valor #>> '{}')::uuid INTO modelo FROM public.configuracoes_plataforma WHERE chave = 'empresa_modelo_id';
  SELECT (valor #>> '{}')::numeric INTO pct FROM public.configuracoes_plataforma WHERE chave = 'comissao_percentual_padrao';
  pct := COALESCE(_percentual_comissao, pct, 5);

  INSERT INTO public.empresas (nome, cnpj, telefone)
  VALUES (trim(_nome), nullif(trim(_cnpj), ''), nullif(trim(_telefone), ''))
  RETURNING id INTO nova;

  IF modelo IS NOT NULL THEN
    INSERT INTO public.config_options (empresa_id, kind, name, active, display_order, metadata)
    SELECT nova, kind, name, active, display_order, metadata
      FROM public.config_options WHERE empresa_id = modelo;

    -- Só listas e textos genéricos. Taxas da maquininha, margens, imposto, quilometragem e metas
    -- são do negócio de cada empresa: ela preenche (o checklist de implantação cobra).
    INSERT INTO public.app_settings (empresa_id, key, value)
    SELECT nova, key, value FROM public.app_settings
     WHERE empresa_id = modelo
       AND key IN ('message_template', 'invoice_message_template', 'crm_novo_lead_apos_dias');
  END IF;

  INSERT INTO public.app_settings (empresa_id, key, value)
  VALUES (nova, 'company', jsonb_build_object('name', trim(_nome), 'document', COALESCE(_cnpj, ''), 'phone', COALESCE(_telefone, '')))
  ON CONFLICT (empresa_id, key) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO public.contratos_comissao (empresa_id, percentual, vigencia_inicio, observacoes)
  VALUES (nova, pct, private.hoje_sp(), 'Contrato inicial');

  RETURN nova;
END $function$;
