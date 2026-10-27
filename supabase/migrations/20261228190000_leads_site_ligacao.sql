-- Leads do site × CRM (27/10/2026, item 8a). leads_site_atualizar passa a:
--  1. casar a mensagem também pelos últimos 8 dígitos do telefone (DDD digitado errado; com ou
--     sem o 9 já casava pela chave DDD + 8 dígitos);
--  2. casar pelo clique do pop-up: o clique da mesma pessoa (mesmo telefone, até 1 h do cadastro)
--     já ligado a um lead pelo código (ref_code) ou pelo telefone → a primeira mensagem do lead;
--  3. copiar a situação da linha original para as linhas repetidas (a pessoa preencheu o pop-up
--     duas vezes: a repetida ficava "nao_chamou" para sempre).
-- Nada é apagado; só a função muda.
CREATE OR REPLACE FUNCTION public.leads_site_atualizar(_emp uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  m record;
  lead uuid;
  lead_clique uuid;
  chamaram int := 0;
  repetidas int := 0;
  oito text;
BEGIN
  FOR r IN
    SELECT s.* FROM public.leads_site s
     WHERE s.empresa_id = _emp AND s.repetido_de IS NULL AND s.telefone IS NOT NULL
       AND s.situacao IN ('nao_chamou', 'chamado_equipe')
       -- Últimos 30 dias; cadastro antigo recém-importado é conferido uma vez também.
       AND (s.cadastrado_em >= now() - interval '30 days' OR s.created_at >= now() - interval '1 hour')
  LOOP
    oito := right(regexp_replace(r.telefone, '\D', '', 'g'), 8);
    m := NULL;
    SELECT coalesce(w.message_timestamp, w.created_at) AS quando, w.conversa_id, w.crm_lead_id
      INTO m
      FROM public.whatsapp_messages w
      JOIN public.whatsapp_contacts c ON c.id = w.whatsapp_contact_id
     WHERE w.empresa_id = _emp AND w.direction = 'Recebida' AND NOT w.privada
       AND c.empresa_id = _emp
       AND (private.telefone_chave(c.normalized_phone) = private.telefone_chave(r.telefone)
            OR (length(oito) = 8 AND right(regexp_replace(c.normalized_phone, '\D', '', 'g'), 8) = oito))
       AND coalesce(w.message_timestamp, w.created_at) >= r.cadastrado_em - interval '1 hour'
     ORDER BY coalesce(w.message_timestamp, w.created_at)
     LIMIT 1;
    IF m.quando IS NULL THEN
      -- Pelo clique do pop-up: mesmo telefone, até 1 h do cadastro, já ligado a um lead.
      SELECT a.crm_lead_id INTO lead_clique
        FROM public.ads_clicks a
       WHERE a.empresa_id = _emp AND a.crm_lead_id IS NOT NULL AND length(oito) = 8
         AND right(regexp_replace(a.telefone_raw, '\D', '', 'g'), 8) = oito
         AND a.created_at BETWEEN r.cadastrado_em - interval '1 hour' AND r.cadastrado_em + interval '1 hour'
       ORDER BY abs(extract(epoch FROM (a.created_at - r.cadastrado_em)))
       LIMIT 1;
      IF lead_clique IS NOT NULL THEN
        SELECT coalesce(w.message_timestamp, w.created_at) AS quando, w.conversa_id, lead_clique AS crm_lead_id
          INTO m
          FROM public.whatsapp_messages w
          LEFT JOIN public.conversas cv ON cv.id = w.conversa_id
         WHERE w.empresa_id = _emp AND w.direction = 'Recebida' AND NOT w.privada
           AND (w.crm_lead_id = lead_clique OR cv.crm_lead_id = lead_clique)
           AND coalesce(w.message_timestamp, w.created_at) >= r.cadastrado_em - interval '1 hour'
         ORDER BY coalesce(w.message_timestamp, w.created_at)
         LIMIT 1;
      END IF;
    END IF;
    CONTINUE WHEN m.quando IS NULL;
    lead := coalesce(
      (SELECT crm_lead_id FROM public.conversas WHERE id = m.conversa_id),
      m.crm_lead_id,
      (SELECT l.id FROM public.crm_leads l
        WHERE l.empresa_id = _emp
          AND private.telefone_chave(l.normalized_phone) = private.telefone_chave(r.telefone)
        ORDER BY l.is_open DESC, coalesce(l.last_interaction_at, l.created_at) DESC
        LIMIT 1));
    UPDATE public.leads_site
       SET situacao = 'chamou', chamou_em = m.quando, conversa_id = m.conversa_id,
           crm_lead_id = coalesce(lead, crm_lead_id)
     WHERE id = r.id;
    chamaram := chamaram + 1;
    IF lead IS NOT NULL THEN
      UPDATE public.crm_leads
         SET lp_origem = coalesce(lp_origem, r.lp), utm_term = coalesce(utm_term, r.utm_term),
             gclid = coalesce(gclid, r.gclid), gbraid = coalesce(gbraid, r.gbraid)
       WHERE id = lead
         AND (lp_origem IS NULL OR (utm_term IS NULL AND r.utm_term IS NOT NULL)
              OR (gclid IS NULL AND r.gclid IS NOT NULL) OR (gbraid IS NULL AND r.gbraid IS NOT NULL));
    END IF;
  END LOOP;

  -- Linhas repetidas seguem a original que já chamou.
  UPDATE public.leads_site s
     SET situacao = 'chamou', chamou_em = o.chamou_em, conversa_id = o.conversa_id,
         crm_lead_id = coalesce(o.crm_lead_id, s.crm_lead_id)
    FROM public.leads_site o
   WHERE s.empresa_id = _emp AND s.repetido_de = o.id
     AND s.situacao IN ('nao_chamou', 'chamado_equipe') AND o.situacao = 'chamou'
     AND s.cadastrado_em >= now() - interval '30 days';
  GET DIAGNOSTICS repetidas = ROW_COUNT;
  RETURN jsonb_build_object('chamaram', chamaram, 'repetidas', repetidas);
END $$;
REVOKE ALL ON FUNCTION public.leads_site_atualizar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leads_site_atualizar(uuid) TO service_role;
