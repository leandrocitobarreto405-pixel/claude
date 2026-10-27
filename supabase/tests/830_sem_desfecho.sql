-- Orçamentos sem desfecho (migração 20261228150000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.como(_email text, _empresa uuid)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false),
         set_config('request.headers', json_build_object('x-empresa-id', _empresa)::text, false);
$$;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

\set E '83000000-0000-4000-8000-00000000000e'
\set L1 '83000000-0000-4000-8000-0000000000a1'
\set L2 '83000000-0000-4000-8000-0000000000a2'
\set L3 '83000000-0000-4000-8000-0000000000a3'
\set L4 '83000000-0000-4000-8000-0000000000a4'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 830');
SELECT private.garantir_motivos_sem_desfecho(:'E');
INSERT INTO auth.users (email) VALUES ('vendedora@p830.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E', 'atendente' FROM auth.users WHERE email = 'vendedora@p830.test';
INSERT INTO public.config_options (empresa_id, kind, name, display_order, metadata)
VALUES (:'E', 'crm_status', 'Desistiu', 9, '{"lost": true}');
-- L1: fim da cadência (sem_desfecho_em); L2: validade + 2 dias vencida; L3: orçamento recente;
-- L4: já tem OS (ganho).
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, first_contact_date, orcamento_enviado_em, sem_desfecho_em, sem_desfecho_motivo) VALUES
  (:'L1', :'E', 'Lead Fictício 1', '11983000001', '5511983000001', current_date - 5, now() - interval '5 days', now(), 'Não respondeu depois dos follow-ups'),
  (:'L2', :'E', 'Lead Fictício 2', '11983000002', '5511983000002', current_date - 20, now() - interval '20 days', null, null),
  (:'L3', :'E', 'Lead Fictício 3', '11983000003', '5511983000003', current_date, now() - interval '1 day', null, null),
  (:'L4', :'E', 'Lead Fictício 4', '11983000004', '5511983000004', current_date - 20, now() - interval '20 days', now(), null);
UPDATE public.crm_leads SET os_criada_em = now() WHERE id = :'L4';
INSERT INTO public.quotes (empresa_id, numero, cliente_nome, status, total, crm_lead_id)
VALUES (:'E', 8301, 'Lead Fictício 1', 'enviado', 450, :'L1'), (:'E', 8302, 'Lead Fictício 2', 'enviado', 300, :'L2');
-- (o orçamento enviado marca a data no lead; volta para 20 dias atrás)
UPDATE public.crm_leads SET orcamento_enviado_em = now() - interval '20 days' WHERE id = :'L2';

SELECT pg_temp.como('vendedora@p830.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok(jsonb_array_length(public.motivos_sem_desfecho()) = 11, '11 motivos');
SELECT pg_temp.ok(jsonb_array_length(public.leads_sem_desfecho()) = 2, 'entram L1 (cadência) e L2 (validade)');
SELECT pg_temp.ok(public.contar_sem_desfecho() = 2, 'contador');
SELECT pg_temp.ok((public.leads_sem_desfecho()->0->>'valor')::numeric IN (450, 300), 'valor do orçamento');

-- L1: "Agenda cheia" com a data que o cliente queria → encerrado, conta como perda
SELECT public.registrar_desfecho(:'L1', (SELECT id FROM public.config_options WHERE empresa_id = :'E' AND name = 'Agenda cheia'),
                                 'queria sábado', current_date + 3);
-- L2: "Adiou" para daqui 10 dias → volta para o follow-up
SELECT public.registrar_desfecho(:'L2', (SELECT id FROM public.config_options WHERE empresa_id = :'E' AND name = 'Adiou'),
                                 null, current_date + 10);
SELECT pg_temp.ok(jsonb_array_length(public.leads_sem_desfecho()) = 0, 'lista vazia depois dos cliques');
SELECT pg_temp.ok((public.perdas_por_motivo(current_date - 1, current_date + 1)->'total'->>'quantidade')::int = 1, 'uma perda no relatório');
SELECT pg_temp.ok((public.perdas_por_motivo(current_date - 1, current_date + 1)->'agenda_cheia'->0->>'dias_frente_media')::int = 3, 'dias à frente');
RESET ROLE;
SELECT pg_temp.ok((SELECT perdido_em IS NOT NULL AND NOT is_open AND data_desejada = current_date + 3 FROM public.crm_leads WHERE id = :'L1'), 'L1 encerrado com a data desejada');
SELECT pg_temp.ok((SELECT perdido_em IS NULL AND next_follow_up_at IS NOT NULL FROM public.crm_leads WHERE id = :'L2'), 'L2 voltou para o follow-up');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.crm_followups WHERE crm_lead_id = :'L2' AND responsavel = 'equipe'), 'follow-up da equipe criado');
ROLLBACK;
