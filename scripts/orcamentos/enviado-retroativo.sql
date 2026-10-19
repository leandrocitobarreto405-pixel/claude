-- Orçamentos salvos e mandados pelo WhatsApp que ficaram em "rascunho" (Turbine, desde 01/10/2026,
-- com telefone): passam a "enviado". O gatilho dos orçamentos recalcula os marcos do lead e leva o
-- lead aberto (Novo contato / Em atendimento...) para "Orçamento enviado", com histórico.
-- A data de "orçamento enviado" do lead fica a do primeiro orçamento (não a de hoje).
-- Rodar dentro de uma transação (o teste de banco usa este arquivo). Nada é apagado.

CREATE TEMP TABLE _retroativo ON COMMIT DROP AS
SELECT q.id, q.crm_lead_id, q.created_at
  FROM public.quotes q
 WHERE q.empresa_id = '11111111-1111-1111-1111-111111111111'
   AND q.status = 'rascunho'
   AND q.created_at >= '2026-10-01 00:00:00-03'
   AND nullif(trim(q.cliente_telefone), '') IS NOT NULL;

UPDATE public.quotes q SET status = 'enviado'
  FROM _retroativo r WHERE q.id = r.id;

-- Histórico: diz que foi o ajuste (o gatilho grava a nota padrão).
UPDATE public.crm_status_history h
   SET notes = 'Orçamento enviado (ajuste de 19/10/2026: orçamentos salvos ficaram em rascunho).'
 WHERE h.crm_lead_id IN (SELECT crm_lead_id FROM _retroativo)
   AND h.change_source = 'Orçamento' AND h.changed_at = now()
   AND h.notes = 'Orçamento enviado ao cliente.';

-- Data real do envio: a do primeiro orçamento do lead.
UPDATE public.crm_leads l
   SET orcamento_enviado_em = least(l.orcamento_enviado_em, x.primeiro)
  FROM (SELECT crm_lead_id, min(created_at) AS primeiro FROM _retroativo
         WHERE crm_lead_id IS NOT NULL GROUP BY 1) x
 WHERE l.id = x.crm_lead_id AND l.orcamento_enviado_em IS NOT NULL;

-- Marcos de novo (idempotente; mantém a data acima).
SELECT private.atualizar_marcos_lead(crm_lead_id)
  FROM (SELECT DISTINCT crm_lead_id FROM _retroativo WHERE crm_lead_id IS NOT NULL) x;

SELECT count(*) AS orcamentos_enviados, count(DISTINCT crm_lead_id) AS leads FROM _retroativo;
