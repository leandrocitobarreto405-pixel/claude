-- OS criada sem partir de um lead: liga sozinha ao lead aberto do CRM com o mesmo telefone
-- (chave DDD + 8 últimos dígitos, a mesma do resto do sistema), para a venda contar no funil e
-- nas conversões do Google Ads.
--  * Roda 10 minutos depois da criação da OS (pela varredura, de 5 em 5 min): quando a OS nasce
--    de um lead (Nova OS, orçamento, Alice), o app liga o lead logo depois de criar a OS; se em
--    10 minutos ninguém ligou, a OS não veio de um lead.
--  * Só liga se houver exatamente um lead aberto (sem OS) com aquele telefone. Nenhum ou mais de
--    um: não liga e registra em ads_eventos (tipo vinculo) para a equipe ver.
--  * OS que já tem lead ligado não é alterada. Cada OS é avaliada uma vez.
--  * A ligação usa private.converter_lead_em_os (mesma regra do app: liga, fecha o lead e põe o
--    status de fechado).
CREATE OR REPLACE FUNCTION public.crm_ligar_os_sem_lead(
  _emp uuid,
  _desde timestamptz DEFAULT '2026-10-13 14:00:00-03'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w record;
  chave text;
  leads uuid[];
  ligadas int := 0;
  sem_lead int := 0;
  varios int := 0;
BEGIN
  FOR w IN
    SELECT o.id, o.os_number, o.empresa_id, c.phone
      FROM public.work_orders o
      LEFT JOIN public.customers c ON c.id = o.customer_id
     WHERE o.empresa_id = _emp
       AND o.deleted_at IS NULL
       AND o.status IS DISTINCT FROM 'Cancelada'
       AND o.created_at >= greatest(_desde, now() - interval '7 days')
       AND o.created_at <= now() - interval '10 minutes'
       AND NOT EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.linked_work_order_id = o.id)
       AND NOT EXISTS (SELECT 1 FROM public.ads_eventos e
                        WHERE e.empresa_id = o.empresa_id AND e.tipo = 'vinculo'
                          AND e.resultado IN ('os_ligada_auto', 'os_sem_lead', 'os_varios_leads')
                          AND e.detalhe->>'work_order_id' = o.id::text)
     ORDER BY o.created_at
  LOOP
    chave := private.telefone_chave(private.normalizar_telefone(w.phone));
    leads := ARRAY(
      SELECT l.id FROM public.crm_leads l
       WHERE l.empresa_id = w.empresa_id AND l.is_open AND l.linked_work_order_id IS NULL
         AND chave IS NOT NULL
         AND private.telefone_chave(l.normalized_phone) = chave);
    IF cardinality(leads) = 1 THEN
      PERFORM private.converter_lead_em_os(leads[1], w.id);
      -- O histórico do status diz de onde veio a conversão.
      UPDATE public.crm_status_history h
         SET change_source = 'Vínculo automático',
             notes = 'Lead ligado automaticamente à OS ' || w.os_number || ' pelo telefone.'
       WHERE h.crm_lead_id = leads[1] AND h.change_source = 'Orçamento'
         AND h.changed_at = now();
      INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, detalhe)
      VALUES (w.empresa_id, 'vinculo', 'os_ligada_auto',
              jsonb_build_object('work_order_id', w.id, 'os_number', w.os_number, 'crm_lead_id', leads[1]));
      ligadas := ligadas + 1;
    ELSE
      INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, detalhe)
      VALUES (w.empresa_id, 'vinculo',
              CASE WHEN cardinality(leads) = 0 THEN 'os_sem_lead' ELSE 'os_varios_leads' END,
              jsonb_build_object('work_order_id', w.id, 'os_number', w.os_number,
                                 'leads_abertos', cardinality(leads),
                                 'sem_telefone', chave IS NULL));
      IF cardinality(leads) = 0 THEN sem_lead := sem_lead + 1; ELSE varios := varios + 1; END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ligadas', ligadas, 'sem_lead', sem_lead, 'varios_leads', varios);
END $$;
REVOKE ALL ON FUNCTION public.crm_ligar_os_sem_lead(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ligar_os_sem_lead(uuid, timestamptz) TO service_role;
