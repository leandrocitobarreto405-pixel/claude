-- Temperatura por eventos (migração 20261228230000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.t(_lead uuid) RETURNS text LANGUAGE sql AS $$
  SELECT temperature || ' / ' || coalesce(temperatura_motivo, '-') FROM public.crm_leads WHERE id = _lead;
$$;
\set E '89000000-0000-4000-8000-00000000000e'
INSERT INTO public.empresas (id, nome, implantacao_liberada_em) VALUES (:'E', 'Empresa Fictícia 890', now());

-- Contatos e leads: a1 retorno em 3 dias; a2 retorno em 20 dias; a3 respondeu depois do
-- orçamento; a4 respondeu mas disse que fechou com outra; a5 orçamento há 4 dias sem resposta;
-- a6 15 dias em silêncio; a7 sem orçamento há 3 dias; a8 recém-chegado (IA desempata);
-- a9 confirmado à mão (não muda); b1 com OS (não muda).
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone)
SELECT ('89000000-0000-4000-8000-0000000000c' || i)::uuid, :'E', '55119890000' || i
  FROM generate_series(1, 9) i;
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, whatsapp_contact_id, temperature,
                              temperatura_ia, orcamento_enviado_em, created_at, temperature_confirmed)
SELECT ('89000000-0000-4000-8000-0000000000a' || i)::uuid, :'E', 'Lead ' || i, '119890000' || i,
       ('89000000-0000-4000-8000-0000000000c' || i)::uuid, 'FRIO', 'FRIO',
       CASE WHEN i IN (1, 2, 3, 4) THEN now() - interval '1 day'
            WHEN i = 5 THEN now() - interval '4 days'
            WHEN i = 6 THEN now() - interval '16 days' END,
       CASE WHEN i = 6 THEN now() - interval '20 days' WHEN i = 8 THEN now() - interval '1 hour'
            ELSE now() - interval '5 days' END,
       i = 9
  FROM generate_series(1, 9) i;
UPDATE public.crm_leads SET temperatura_ia = 'QUENTE'
 WHERE id = '89000000-0000-4000-8000-0000000000a8';
-- Os marcos do lead são recalculados no INSERT (sem orçamento no banco): data do orçamento depois.
UPDATE public.crm_leads
   SET orcamento_enviado_em = CASE WHEN right(id::text, 1) IN ('1', '2', '3', '4') THEN now() - interval '1 day'
                                   WHEN right(id::text, 1) = '5' THEN now() - interval '4 days'
                                   WHEN right(id::text, 1) = '6' THEN now() - interval '16 days' END
 WHERE empresa_id = :'E';

INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, direction, message_timestamp, text_content)
VALUES (:'E', '89000000-0000-4000-8000-0000000000c3', 'Recebida', now() - interval '2 hours', 'pode ser sexta?'),
       (:'E', '89000000-0000-4000-8000-0000000000c4', 'Recebida', now() - interval '2 hours', 'já fechei com outra'),
       (:'E', '89000000-0000-4000-8000-0000000000c5', 'Recebida', now() - interval '5 days', 'quanto fica?'),
       (:'E', '89000000-0000-4000-8000-0000000000c6', 'Recebida', now() - interval '15 days', 'oi'),
       (:'E', '89000000-0000-4000-8000-0000000000c7', 'Recebida', now() - interval '3 days', 'oi'),
       (:'E', '89000000-0000-4000-8000-0000000000c8', 'Recebida', now() - interval '1 hour', 'oi');
INSERT INTO public.crm_followups (empresa_id, crm_lead_id, scheduled_at, status, responsavel, trilha)
VALUES (:'E', '89000000-0000-4000-8000-0000000000a1', now() + interval '3 days', 'Pendente', 'equipe', NULL),
       (:'E', '89000000-0000-4000-8000-0000000000a2', now() + interval '20 days', 'Pendente', 'alice', 'C');

-- Lido pelo classificador depois da última resposta.
UPDATE public.crm_leads SET contexto_classe = 'fechou_outra', contexto_lido_em = now()
 WHERE id = '89000000-0000-4000-8000-0000000000a4';

SELECT pg_temp.ok((SELECT count(*) FROM public.crm_temperatura_para_ler_contexto(50) p
                    WHERE p.empresa_id = :'E') = 0, 'sem Alice ligada não lê contexto');

SELECT public.crm_recalcular_temperaturas();

SELECT pg_temp.ok(pg_temp.t('89000000-0000-4000-8000-0000000000a1') = 'QUENTE / Retorno combinado em até 7 dias', 'a1 ' || pg_temp.t('89000000-0000-4000-8000-0000000000a1'));
SELECT pg_temp.ok((SELECT retorno_combinado_em IS NOT NULL FROM public.crm_leads WHERE id = '89000000-0000-4000-8000-0000000000a1'), 'a1 com selo de retorno');
SELECT pg_temp.ok(pg_temp.t('89000000-0000-4000-8000-0000000000a2') = 'MORNO / Retorno combinado daqui a mais de 7 dias', 'a2 ' || pg_temp.t('89000000-0000-4000-8000-0000000000a2'));
SELECT pg_temp.ok(pg_temp.t('89000000-0000-4000-8000-0000000000a3') = 'QUENTE / Respondeu nas últimas 48 h depois do orçamento', 'a3 ' || pg_temp.t('89000000-0000-4000-8000-0000000000a3'));
SELECT pg_temp.ok(pg_temp.t('89000000-0000-4000-8000-0000000000a4') LIKE 'FRIO / Cliente disse%', 'a4 ' || pg_temp.t('89000000-0000-4000-8000-0000000000a4'));
SELECT pg_temp.ok(pg_temp.t('89000000-0000-4000-8000-0000000000a5') = 'MORNO / Orçamento sem resposta há 2 a 7 dias', 'a5 ' || pg_temp.t('89000000-0000-4000-8000-0000000000a5'));
SELECT pg_temp.ok(pg_temp.t('89000000-0000-4000-8000-0000000000a6') = 'FRIO / Mais de 10 dias em silêncio', 'a6 ' || pg_temp.t('89000000-0000-4000-8000-0000000000a6'));
SELECT pg_temp.ok(pg_temp.t('89000000-0000-4000-8000-0000000000a7') = 'FRIO / Ficou sem orçamento', 'a7 ' || pg_temp.t('89000000-0000-4000-8000-0000000000a7'));
SELECT pg_temp.ok(pg_temp.t('89000000-0000-4000-8000-0000000000a8') = 'QUENTE / IA: leitura da conversa', 'a8 ' || pg_temp.t('89000000-0000-4000-8000-0000000000a8'));
SELECT pg_temp.ok(pg_temp.t('89000000-0000-4000-8000-0000000000a9') = 'FRIO / -', 'a9 confirmado à mão não muda');

-- Só a temperatura mudou: o updated_at fica como estava.
ALTER TABLE public.crm_leads DISABLE TRIGGER trg_crm_leads_upd, DISABLE TRIGGER trg_crm_leads_upd_temperatura;
UPDATE public.crm_leads SET updated_at = '2026-01-01' WHERE id = '89000000-0000-4000-8000-0000000000a5';
ALTER TABLE public.crm_leads ENABLE TRIGGER trg_crm_leads_upd, ENABLE TRIGGER trg_crm_leads_upd_temperatura;
UPDATE public.crm_leads SET temperature = 'QUENTE' WHERE id = '89000000-0000-4000-8000-0000000000a5';
SELECT pg_temp.ok((SELECT updated_at FROM public.crm_leads WHERE id = '89000000-0000-4000-8000-0000000000a5') = '2026-01-01', 'temperatura não mexe no updated_at');
UPDATE public.crm_leads SET notes = 'x' WHERE id = '89000000-0000-4000-8000-0000000000a5';
SELECT pg_temp.ok((SELECT updated_at FROM public.crm_leads WHERE id = '89000000-0000-4000-8000-0000000000a5') > '2026-01-01', 'outras colunas mexem no updated_at');

-- Rodar de novo só grava o que mudou (a5 voltou para MORNO).
SELECT pg_temp.ok(public.crm_recalcular_temperaturas() = 1, 'segunda rodada grava só a5');

-- Valor fora da lista não passa.
DO $$ BEGIN
  UPDATE public.crm_leads SET temperature = 'MORNA' WHERE id = '89000000-0000-4000-8000-0000000000a5';
  RAISE EXCEPTION 'FALHOU: temperatura inválida passou';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- Lead que virou OS perde o selo do retorno.
UPDATE public.crm_leads SET is_open = false WHERE id = '89000000-0000-4000-8000-0000000000a1';
SELECT public.crm_recalcular_temperaturas();
SELECT pg_temp.ok((SELECT retorno_combinado_em IS NULL FROM public.crm_leads WHERE id = '89000000-0000-4000-8000-0000000000a1'), 'lead fechado sem selo');

-- Com a Alice ligada, a3 (respondeu e não foi lido) entra na leitura de contexto; a4 já foi lido.
INSERT INTO public.ia_configuracoes (empresa_id, ativo) VALUES (:'E', true)
ON CONFLICT (empresa_id) DO UPDATE SET ativo = true;
SELECT pg_temp.ok((SELECT array_agg(p.lead_id) FROM public.crm_temperatura_para_ler_contexto(50) p
                    WHERE p.empresa_id = :'E') = ARRAY['89000000-0000-4000-8000-0000000000a3'::uuid], 'só a3 para ler');
ROLLBACK;
