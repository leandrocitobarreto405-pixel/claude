-- Configuração da empresa (parte 2): a reserva do disparo não pega envios de empresa
-- ainda não liberada pela Nexa. O resto da função é igual ao que estava em produção.

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
      -- Empresa ainda em implantação não envia nada a clientes.
      JOIN public.empresas emp ON emp.id = e.empresa_id AND emp.implantacao_liberada_em IS NOT NULL
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
