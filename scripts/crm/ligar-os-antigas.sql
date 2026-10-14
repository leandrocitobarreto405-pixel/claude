-- Script único (fase 2), Turbine: liga as OS antigas sem lead ao ÚNICO lead do CRM com o mesmo
-- telefone (chave DDD + 8 últimos dígitos), pela mesma regra do vínculo automático
-- (private.converter_lead_em_os): liga, encerra o lead como convertido, copia a origem para o lado
-- vazio e registra em ads_eventos. OS com nenhum ou mais de um lead ficam como estão.
--
-- SÓ RODAR DEPOIS DO OK DO DONO, com a lista conferida (ver docs/nexa-os/PUBLICACOES.md, fase 2).
-- Efeitos de cada ligação: lead fecha (status "Agendado", etapa pelo marco da OS), retornos
-- pendentes do lead são concluídos ("Lead virou OS") e os da Alice cancelados, e a venda entra
-- na exportação do Google Ads SE o lead tiver clique com gclid de até 90 dias antes da OS.
-- Nada manda mensagem para cliente. Nada de marketing muda (os gatilhos de marketing só
-- reagem a lead novo ou telefone trocado).
--
-- Modo de ver antes (sem gravar): rode só o SELECT de "pre" abaixo.
WITH os AS (
  SELECT o.id, o.os_number, o.empresa_id, private.telefone_chave(private.normalizar_telefone(c.phone)) AS chave
    FROM public.work_orders o LEFT JOIN public.customers c ON c.id = o.customer_id
   WHERE o.empresa_id = '11111111-1111-1111-1111-111111111111' AND o.deleted_at IS NULL
     AND o.status IS DISTINCT FROM 'Cancelada'
     AND NOT EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.linked_work_order_id = o.id)
), pre AS (
  SELECT os.id AS work_order_id, os.os_number, os.empresa_id,
         (ARRAY(SELECT l.id FROM public.crm_leads l
                 WHERE l.empresa_id = os.empresa_id AND l.linked_work_order_id IS NULL AND os.chave IS NOT NULL
                   AND private.telefone_chave(l.normalized_phone) = os.chave))[1] AS lead_id,
         (SELECT count(*) FROM public.crm_leads l
           WHERE l.empresa_id = os.empresa_id AND l.linked_work_order_id IS NULL AND os.chave IS NOT NULL
             AND private.telefone_chave(l.normalized_phone) = os.chave) AS leads
    FROM os
), feito AS (
  SELECT p.*, private.converter_lead_em_os(p.lead_id, p.work_order_id)
    FROM pre p WHERE p.leads = 1
), hist AS (
  UPDATE public.crm_status_history h
     SET change_source = 'Vínculo automático',
         notes = 'Lead ligado à OS ' || f.os_number || ' pelo telefone (correção da fase 2).'
    FROM feito f
   WHERE h.crm_lead_id = f.lead_id AND h.change_source = 'Orçamento' AND h.changed_at >= now() - interval '1 minute'
  RETURNING h.crm_lead_id
), ev AS (
  INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, detalhe)
  SELECT f.empresa_id, 'vinculo', 'os_ligada_auto',
         jsonb_build_object('work_order_id', f.work_order_id, 'os_number', f.os_number, 'crm_lead_id', f.lead_id, 'origem', 'correcao_fase2')
    FROM feito f
  RETURNING id
)
SELECT f.os_number, f.lead_id FROM feito f ORDER BY f.os_number;
