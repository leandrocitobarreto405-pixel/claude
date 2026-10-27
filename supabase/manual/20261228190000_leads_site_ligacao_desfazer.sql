-- Desfaz 20261228190000_leads_site_ligacao: volta a função de 20261105120000 (casar só pela
-- chave do telefone, sem repetidas nem clique). As linhas já marcadas como "chamou" ficam.
CREATE OR REPLACE FUNCTION public.leads_site_atualizar(_emp uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  m record;
  lead uuid;
  chamaram int := 0;
BEGIN
  FOR r IN
    SELECT s.* FROM public.leads_site s
     WHERE s.empresa_id = _emp AND s.repetido_de IS NULL AND s.telefone IS NOT NULL
       AND s.situacao IN ('nao_chamou', 'chamado_equipe')
       -- Últimos 30 dias; cadastro antigo recém-importado é conferido uma vez também.
       AND (s.cadastrado_em >= now() - interval '30 days' OR s.created_at >= now() - interval '1 hour')
  LOOP
    SELECT coalesce(w.message_timestamp, w.created_at) AS quando, w.conversa_id, w.crm_lead_id
      INTO m
      FROM public.whatsapp_messages w
      JOIN public.whatsapp_contacts c ON c.id = w.whatsapp_contact_id
     WHERE w.empresa_id = _emp AND w.direction = 'Recebida' AND NOT w.privada
       AND c.empresa_id = _emp
       AND private.telefone_chave(c.normalized_phone) = private.telefone_chave(r.telefone)
       AND coalesce(w.message_timestamp, w.created_at) >= r.cadastrado_em - interval '1 hour'
     ORDER BY coalesce(w.message_timestamp, w.created_at)
     LIMIT 1;
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
  RETURN jsonb_build_object('chamaram', chamaram);
END $$;
REVOKE ALL ON FUNCTION public.leads_site_atualizar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leads_site_atualizar(uuid) TO service_role;
