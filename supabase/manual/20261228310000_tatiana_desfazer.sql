-- Desfaz a migração 20261228310000_tatiana (só com OK). Volta a função de marcos à versão de
-- 20260929120000; os leads mantêm a marca de orçamento enviado que já ganharam.
BEGIN;
DROP TRIGGER IF EXISTS trg_whatsapp_messages_preco ON public.whatsapp_messages;
DROP FUNCTION IF EXISTS private.mensagem_marca_preco();
DROP TRIGGER IF EXISTS trg_crm_leads_pegar_orcamentos ON public.crm_leads;
DROP FUNCTION IF EXISTS private.crm_leads_pegar_orcamentos();

CREATE OR REPLACE FUNCTION private.atualizar_marcos_lead(_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.crm_leads;
  v_orcamento timestamptz;
  v_enviado timestamptz;
  v_aprovado timestamptz;
  v_os timestamptz;
  v_agendado timestamptz;
  v_realizado timestamptz;
  v_faturado timestamptz;
BEGIN
  IF _lead_id IS NULL THEN RETURN; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id = _lead_id;
  IF l.id IS NULL THEN RETURN; END IF;
  SELECT min(q.created_at),
         CASE WHEN bool_or(q.status IN ('enviado', 'aprovado', 'recusado', 'convertido'))
              THEN coalesce(l.orcamento_enviado_em, now()) END,
         CASE WHEN bool_or(q.status IN ('aprovado', 'convertido'))
              THEN coalesce(l.orcamento_aprovado_em, now()) END
    INTO v_orcamento, v_enviado, v_aprovado
    FROM public.quotes q
   WHERE q.crm_lead_id = l.id AND q.empresa_id = l.empresa_id;
  IF l.linked_work_order_id IS NOT NULL THEN
    SELECT w.created_at INTO v_os FROM public.work_orders w
     WHERE w.id = l.linked_work_order_id AND w.empresa_id = l.empresa_id AND w.deleted_at IS NULL;
  END IF;
  IF v_os IS NOT NULL THEN
    SELECT min(v.created_at) FILTER (WHERE v.status IS DISTINCT FROM 'Cancelado'),
           min(coalesce((v.completion_date + coalesce(v.completion_time, time '12:00'))
                          AT TIME ZONE 'America/Sao_Paulo', v.updated_at))
             FILTER (WHERE v.status = 'Concluído')
      INTO v_agendado, v_realizado
      FROM public.visits v
     WHERE v.work_order_id = l.linked_work_order_id AND v.empresa_id = l.empresa_id;
    SELECT min((p.payment_date + time '12:00') AT TIME ZONE 'America/Sao_Paulo')
      INTO v_faturado
      FROM public.payments p
     WHERE p.work_order_id = l.linked_work_order_id AND p.empresa_id = l.empresa_id
       AND p.is_active AND p.payment_status = 'Pago';
  END IF;
  IF (l.orcamento_em, l.orcamento_enviado_em, l.orcamento_aprovado_em, l.os_criada_em,
      l.agendado_em, l.realizado_em, l.faturado_em)
     IS DISTINCT FROM (v_orcamento, v_enviado, v_aprovado, v_os, v_agendado, v_realizado, v_faturado)
  THEN
    UPDATE public.crm_leads
       SET orcamento_em = v_orcamento, orcamento_enviado_em = v_enviado,
           orcamento_aprovado_em = v_aprovado, os_criada_em = v_os, agendado_em = v_agendado,
           realizado_em = v_realizado, faturado_em = v_faturado
     WHERE id = l.id;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.comercial_resolver_cobranca(uuid, text, text);
DROP TABLE IF EXISTS public.comercial_recados;
DROP TABLE IF EXISTS public.comercial_cobrancas;
DROP TABLE IF EXISTS public.comercial_decisoes;
DROP TABLE IF EXISTS public.comercial_noites;
DELETE FROM public.crm_followups WHERE trilha = 'G';
ALTER TABLE public.crm_followups DROP CONSTRAINT IF EXISTS crm_followups_trilha_check;
ALTER TABLE public.crm_followups ADD CONSTRAINT crm_followups_trilha_check
  CHECK (trilha IS NULL OR trilha IN ('A', 'B', 'C'));
ALTER TABLE public.crm_followups
  DROP COLUMN IF EXISTS origem, DROP COLUMN IF EXISTS mensagem, DROP COLUMN IF EXISTS motivo,
  DROP COLUMN IF EXISTS prioridade, DROP COLUMN IF EXISTS pulado_motivo;
ALTER TABLE public.comercial_analises
  DROP COLUMN IF EXISTS caixinha, DROP COLUMN IF EXISTS caixinha_em,
  DROP COLUMN IF EXISTS etiquetas, DROP COLUMN IF EXISTS fora_area;
ALTER TABLE public.comercial_configuracoes
  DROP COLUMN IF EXISTS modo, DROP COLUMN IF EXISTS teto_mensal_usd,
  DROP COLUMN IF EXISTS hora_noite, DROP COLUMN IF EXISTS alerta_teto_mes;
DELETE FROM public.push_envios WHERE tipo IN ('tatiana_tarefas', 'tatiana_cobrancas');
ALTER TABLE public.push_envios DROP CONSTRAINT IF EXISTS push_envios_tipo_check;
ALTER TABLE public.push_envios ADD CONSTRAINT push_envios_tipo_check
  CHECK (tipo IN ('cliente_esperando', 'servico_concluido', 'campanha_aprovacao', 'agendamento_promocao',
                  'resumo_dia', 'teste'));
ALTER TABLE public.push_preferencias
  DROP COLUMN IF EXISTS tatiana_tarefas, DROP COLUMN IF EXISTS tatiana_cobrancas;
-- crm_leads.orcamento_origem fica (já existia antes, de 20261228210000).
COMMIT;
