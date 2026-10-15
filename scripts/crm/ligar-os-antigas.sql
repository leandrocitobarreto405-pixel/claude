-- Script único (fase 2, aprovado em 14/10/2026), Turbine: liga as OS antigas sem lead ao ÚNICO
-- lead do CRM com o mesmo telefone (chave DDD + 8 últimos dígitos), pela mesma regra do vínculo
-- automático (private.converter_lead_em_os): liga, encerra o lead como convertido, copia a origem
-- para o lado vazio e registra em ads_eventos. OS com nenhum ou mais de um lead ficam como estão.
-- OS de teste (eh_teste) ficam de fora: a 1672 foi marcada como teste antes de rodar.
--
-- Efeitos de cada ligação: lead fecha (status "Agendado", etapa pelo marco da OS), retornos
-- pendentes do lead são concluídos ("Lead virou OS") e os da Alice cancelados, e a venda entra
-- na exportação do Google Ads SE o lead tiver clique com gclid de até 90 dias antes da OS.
-- Nada manda mensagem para cliente. Nada de marketing muda (os gatilhos de marketing só
-- reagem a lead novo ou telefone trocado). Idempotente: OS já ligada não entra de novo.
DO $$
DECLARE
  w record;
  leads uuid[];
  ligadas int := 0;
BEGIN
  FOR w IN
    SELECT o.id, o.os_number, o.empresa_id,
           private.telefone_chave(private.normalizar_telefone(c.phone)) AS chave
      FROM public.work_orders o LEFT JOIN public.customers c ON c.id = o.customer_id
     WHERE o.empresa_id = '11111111-1111-1111-1111-111111111111' AND o.deleted_at IS NULL
       AND o.status IS DISTINCT FROM 'Cancelada' AND NOT o.eh_teste
       AND NOT EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.linked_work_order_id = o.id)
     ORDER BY o.os_number
  LOOP
    leads := ARRAY(
      SELECT l.id FROM public.crm_leads l
       WHERE l.empresa_id = w.empresa_id AND l.linked_work_order_id IS NULL AND w.chave IS NOT NULL
         AND private.telefone_chave(l.normalized_phone) = w.chave);
    IF cardinality(leads) <> 1 THEN
      RAISE NOTICE 'OS % fica como está (% lead(s) pelo telefone)', w.os_number, cardinality(leads);
      CONTINUE;
    END IF;
    PERFORM private.converter_lead_em_os(leads[1], w.id);
    UPDATE public.crm_status_history h
       SET change_source = 'Vínculo automático',
           notes = 'Lead ligado à OS ' || w.os_number || ' pelo telefone (correção da fase 2, 14/10/2026).'
     WHERE h.crm_lead_id = leads[1] AND h.change_source = 'Orçamento' AND h.changed_at = now();
    INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, detalhe)
    VALUES (w.empresa_id, 'vinculo', 'os_ligada_auto',
            jsonb_build_object('work_order_id', w.id, 'os_number', w.os_number, 'crm_lead_id', leads[1],
                               'origem', 'correcao_fase2'));
    ligadas := ligadas + 1;
    RAISE NOTICE 'OS % ligada ao lead %', w.os_number, leads[1];
  END LOOP;
  RAISE NOTICE '% OS ligadas', ligadas;
END $$;
