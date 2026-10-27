-- Leads do site × CRM (migração 20261228190000): repetida segue a original, últimos 8 dígitos com
-- DDD diferente e clique do pop-up ligado ao lead. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '87000000-0000-4000-8000-00000000000e'
\set P '87000000-0000-4000-8000-0000000000f1'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 870');
INSERT INTO public.leads_site_planilhas (id, empresa_id, nome, planilha_id) VALUES (:'P', :'E', 'LP Teste 870', 'planilha-teste-870000000001');
-- Contatos: A (mesmo número), B (DDD 21 no WhatsApp, 11 no pop-up), C (número diferente; o clique
-- do pop-up foi ligado ao lead C pelo código).
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone) VALUES
  ('87000000-0000-4000-8000-00000000000a', :'E', '5511987001001'),
  ('87000000-0000-4000-8000-00000000000b', :'E', '5521987001002'),
  ('87000000-0000-4000-8000-00000000000c', :'E', '5511912345678');
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone)
VALUES ('87000000-0000-4000-8000-0000000003cc', :'E', 'Lead Fictício C', '11912345678', '5511912345678');
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, direction, message_timestamp, crm_lead_id) VALUES
  (:'E', '87000000-0000-4000-8000-00000000000a', 'Recebida', now() - interval '50 minutes', null),
  (:'E', '87000000-0000-4000-8000-00000000000b', 'Recebida', now() - interval '50 minutes', null),
  (:'E', '87000000-0000-4000-8000-00000000000c', 'Recebida', now() - interval '50 minutes', '87000000-0000-4000-8000-0000000003cc');
INSERT INTO public.ads_clicks (empresa_id, telefone_raw, gclid, servico, crm_lead_id, created_at, ref_code)
VALUES (:'E', '11987001003', 'gclid-teste-870', 'higienizacao', '87000000-0000-4000-8000-0000000003cc', now() - interval '61 minutes', 'K870A');
INSERT INTO public.leads_site (id, empresa_id, planilha_id, linha, chave, lp, cadastrado_em, telefone, situacao, repetido_de) VALUES
  ('87000000-0000-4000-8000-0000000001a1', :'E', :'P', 2, 'k2', 'LP Teste', now() - interval '1 hour', '5511987001001', 'nao_chamou', null),
  ('87000000-0000-4000-8000-0000000001a2', :'E', :'P', 3, 'k3', 'LP Teste', now() - interval '59 minutes', '5511987001001', 'nao_chamou', '87000000-0000-4000-8000-0000000001a1'),
  ('87000000-0000-4000-8000-0000000001b1', :'E', :'P', 4, 'k4', 'LP Teste', now() - interval '1 hour', '5511987001002', 'nao_chamou', null),
  ('87000000-0000-4000-8000-0000000001c1', :'E', :'P', 5, 'k5', 'LP Teste', now() - interval '1 hour', '5511987001003', 'nao_chamou', null),
  ('87000000-0000-4000-8000-0000000001d1', :'E', :'P', 6, 'k6', 'LP Teste', now() - interval '1 hour', '5511987009999', 'nao_chamou', null);
SELECT pg_temp.ok((public.leads_site_atualizar(:'E')->>'repetidas')::int = 1, 'uma repetida atualizada');
SELECT pg_temp.ok((SELECT situacao = 'chamou' FROM public.leads_site WHERE id = '87000000-0000-4000-8000-0000000001a2'), 'repetida segue a original');
SELECT pg_temp.ok((SELECT situacao = 'chamou' FROM public.leads_site WHERE id = '87000000-0000-4000-8000-0000000001b1'), 'DDD diferente: últimos 8 dígitos');
SELECT pg_temp.ok((SELECT situacao = 'chamou' AND crm_lead_id = '87000000-0000-4000-8000-0000000003cc'
                     FROM public.leads_site WHERE id = '87000000-0000-4000-8000-0000000001c1'), 'pelo clique do pop-up');
SELECT pg_temp.ok((SELECT situacao = 'nao_chamou' FROM public.leads_site WHERE id = '87000000-0000-4000-8000-0000000001d1'), 'quem não chamou continua');
ROLLBACK;
