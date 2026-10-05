-- Campanha com dia e horário próprios (Marketing → Nova campanha → "Escolher dia e horário").
-- 1. mkt_campanhas.hora_inicio: vazio = dias e horário da configuração (como sempre; as campanhas
--    do calendário não mudam). Preenchido (8h às 20h): as datas escolhidas valem em qualquer dia,
--    inclusive hoje, e o disparo começa nesse horário.
-- 2. Aprovação: com horário próprio, até 10 minutos antes do primeiro disparo (sem ele, até a véspera).
--    Os envios ficam agendados para a data do lote no horário escolhido.
-- 3. Reserva do envio: campanha com horário próprio sai no dia e hora agendados, das 8h às 21h,
--    com o envio ligado. Todo o resto (opt-out, interno, limite de marketing, travas) igual.
-- O preparo (que aceita hoje e qualquer dia com horário próprio) vai pelo SQL Editor:
-- 20261026120001_preparar_horario.sql.

ALTER TABLE public.mkt_campanhas
  ADD COLUMN IF NOT EXISTS hora_inicio time
    CHECK (hora_inicio IS NULL OR hora_inicio BETWEEN time '08:00' AND time '20:00');

CREATE OR REPLACE FUNCTION public.mkt_aprovar_campanha(_campanha uuid, _usuario uuid, _hoje date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hoje date := coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  c public.mkt_campanhas;
  cfg public.mkt_configuracoes;
  primeira date;
BEGIN
  SELECT * INTO c FROM public.mkt_campanhas WHERE id = _campanha FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Campanha não encontrada.'; END IF;
  IF c.status <> 'aguardando_aprovacao' THEN
    RAISE EXCEPTION 'Só dá para aprovar campanha aguardando aprovação (está %).', c.status;
  END IF;
  SELECT min(data_prevista) INTO primeira FROM public.mkt_lotes WHERE campanha_id = c.id;
  IF c.hora_inicio IS NULL THEN
    IF primeira IS NULL OR primeira <= hoje THEN
      RAISE EXCEPTION 'O prazo de aprovação acabou (véspera do primeiro disparo).';
    END IF;
  ELSIF primeira IS NULL OR _hoje IS NULL
        AND ((primeira + c.hora_inicio)::timestamp AT TIME ZONE 'America/Sao_Paulo') < now() + interval '10 minutes' THEN
    -- Horário próprio: dá para aprovar até 10 minutos antes do primeiro disparo.
    RAISE EXCEPTION 'O prazo de aprovação acabou (até 10 minutos antes do primeiro disparo).';
  END IF;
  cfg := private.mkt_config(c.empresa_id);
  UPDATE public.mkt_envios e
     SET agendado_para = ((l.data_prevista + coalesce(c.hora_inicio, make_time(cfg.hora_disparo, 0, 0)))::timestamp
                          AT TIME ZONE 'America/Sao_Paulo')
                         + make_interval(secs => e.ordem * cfg.intervalo_segundos)
    FROM public.mkt_lotes l
   WHERE l.id = e.lote_id AND e.campanha_id = c.id AND e.status = 'pendente';
  UPDATE public.mkt_lotes SET status = 'aprovado' WHERE campanha_id = c.id AND status = 'preparado';
  UPDATE public.mkt_campanhas SET status = 'aprovada', aprovada_em = now(), aprovada_por = _usuario,
         motivo_status = NULL WHERE id = c.id;
  PERFORM private.mkt_log(c.empresa_id, 'campanha', 'aprovada', jsonb_build_object('usuario', _usuario), c.id);
  RETURN jsonb_build_object('status', 'aprovada', 'primeiro_disparo', primeira);
END $$;
REVOKE ALL ON FUNCTION public.mkt_aprovar_campanha(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_aprovar_campanha(uuid, uuid, date) TO service_role;

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
  -- Limite de marketing: recebeu outra campanha ou promoção há menos de N dias.
  UPDATE public.mkt_envios e
     SET status = 'cancelado',
         erro = 'limite de marketing: recebeu outra mensagem há menos de '
                || private.mkt_limite_marketing(e.empresa_id) || ' dias'
    FROM public.mkt_campanhas k
   WHERE k.id = e.campanha_id AND k.tipo IN ('calendario', 'promocao')
     AND e.status = 'pendente' AND e.agendado_para <= agora
     AND EXISTS (
       SELECT 1 FROM public.mkt_envios o JOIN public.mkt_campanhas ok ON ok.id = o.campanha_id
        WHERE o.contato_id = e.contato_id AND o.id <> e.id AND ok.tipo IN ('calendario', 'promocao')
          AND o.status IN ('enviado', 'enviando')
          AND coalesce(o.enviado_em, o.reservado_em)
              > agora - make_interval(days => private.mkt_limite_marketing(e.empresa_id)));
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
      -- Empresa ainda em implantação não envia nada a clientes.
      JOIN public.empresas emp ON emp.id = e.empresa_id AND emp.implantacao_liberada_em IS NOT NULL
     WHERE e.status = 'pendente' AND e.agendado_para <= agora
       AND l.status IN ('aprovado', 'enviando')
       -- Campanha com dia e horário próprios: vale o agendado (dia e hora escolhidos), até as 21h.
       AND ((k.tipo = 'calendario' AND k.hora_inicio IS NOT NULL AND k.status IN ('aprovada', 'enviando')
             AND cfg.disparo_ligado)
         OR (k.tipo = 'calendario' AND k.hora_inicio IS NULL AND k.status IN ('aprovada', 'enviando')
             AND cfg.disparo_ligado AND hora < cfg.hora_limite
             AND dia = ANY (cfg.dias_disparo) AND hora >= cfg.hora_disparo)
         OR (k.tipo = 'promocao' AND k.status IN ('aprovada', 'enviando') AND cfg.disparo_ligado
             AND hora < cfg.hora_limite AND hora >= 9)
         OR (k.tipo = 'gatilho' AND hora < cfg.hora_limite AND hora >= 9
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

