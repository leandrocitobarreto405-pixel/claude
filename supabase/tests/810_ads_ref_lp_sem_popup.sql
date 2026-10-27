-- Pop-up ligado pelo código (migração 20261228130000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '81000000-0000-4000-8000-000000000001'
\set L1 '81000000-0000-4000-8000-0000000000a1'
\set L2 '81000000-0000-4000-8000-0000000000a2'
\set L3 '81000000-0000-4000-8000-0000000000a3'
\set W1 '81000000-0000-4000-8000-0000000000b1'
\set W2 '81000000-0000-4000-8000-0000000000b2'
\set W3 '81000000-0000-4000-8000-0000000000b3'
\set K1 '81000000-0000-4000-8000-0000000000c1'
\set K3 '81000000-0000-4000-8000-0000000000c3'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Pop-up 810');
INSERT INTO public.config_options (id, empresa_id, kind, name, display_order)
VALUES ('81000000-0000-4000-8000-0000000000d1', :'E', 'sales_origin', 'Google Ads – landing', 1);
INSERT INTO public.mensagens_origem (empresa_id, texto, sales_origin_id, exige_popup)
VALUES (:'E', 'Olá, gostaria de um orçamento para higienização dos meus estofados, por favor.',
        '81000000-0000-4000-8000-0000000000d1', true);
INSERT INTO public.whatsapp_contacts (id, empresa_id, wa_id, normalized_phone) VALUES
  (:'W1', :'E', '5511981000001', '5511981000001'), (:'W2', :'E', '5511981000002', '5511981000002'),
  (:'W3', :'E', '5511981000003', '5511981000003');
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, first_contact_date) VALUES
  (:'L1', :'E', 'Lead 1', '11981000001', '5511981000001', current_date),
  (:'L2', :'E', 'Lead 2', '11981000002', '5511981000002', current_date),
  (:'L3', :'E', 'Lead 3', '11981000003', '5511981000003', current_date);

SELECT pg_temp.ok(private.ads_ref_da_mensagem('Olá, ... por favor. (cód. 4f2kq)') = '4F2KQ', 'lê o código do fim');
SELECT pg_temp.ok(private.ads_ref_da_mensagem('Olá (cod 4F2KQ) e mais texto') IS NULL, 'código só no fim');

-- 1) pop-up com OUTRO telefone e código; a mensagem com o código liga o clique ao lead
INSERT INTO public.ads_clicks (id, empresa_id, telefone_raw, gclid, servico)
VALUES (:'K1', :'E', '11981009999', 'gclid-teste-810', 'higienizacao');
SELECT pg_temp.ok((public.ads_definir_ref(:'K1', '4F2KQ')->>'resultado') = 'ok', 'código gravado no clique');
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, crm_lead_id, direction, text_content, message_timestamp)
VALUES (:'E', :'W1', :'L1', 'Recebida', 'Olá, gostaria de um orçamento para higienização dos meus estofados, por favor. (cód. 4F2KQ)', now());
SELECT pg_temp.ok((SELECT crm_lead_id FROM public.ads_clicks WHERE id = :'K1') = :'L1', 'clique ligado pelo código');
SELECT pg_temp.ok((SELECT lp_sem_popup_em FROM public.crm_leads WHERE id = :'L1') IS NULL, 'com pop-up: não marca');

-- 2) frase de LP sem pop-up nenhum: marca "LP sem pop-up"; segunda mensagem não muda
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, crm_lead_id, direction, text_content, message_timestamp)
VALUES (:'E', :'W2', :'L2', 'Recebida', 'Olá, gostaria de um orçamento para higienização dos meus estofados, por favor.', now());
SELECT pg_temp.ok((SELECT lp_sem_popup_em FROM public.crm_leads WHERE id = :'L2') IS NOT NULL, 'sem pop-up: marca');

-- 3) mensagem primeiro, registro do pop-up depois (atrasado): liga na hora e desmarca
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, crm_lead_id, direction, text_content, message_timestamp)
VALUES (:'E', :'W3', :'L3', 'Recebida', 'Olá, gostaria de um orçamento para higienização dos meus estofados, por favor. (cód. ZZ77K)', now());
SELECT pg_temp.ok((SELECT lp_sem_popup_em FROM public.crm_leads WHERE id = :'L3') IS NOT NULL, 'antes do registro: marcado');
INSERT INTO public.ads_clicks (id, empresa_id, telefone_raw, gclid, servico)
VALUES (:'K3', :'E', '11981008888', 'gclid-teste-810b', 'higienizacao');
SELECT pg_temp.ok((public.ads_definir_ref(:'K3', 'ZZ77K')->>'ligado')::boolean, 'registro atrasado liga pelo código');
SELECT pg_temp.ok((SELECT lp_sem_popup_em FROM public.crm_leads WHERE id = :'L3') IS NULL, 'ligado depois: desmarca');

-- 4) código repetido em outro clique é recusado
SELECT pg_temp.ok((public.ads_definir_ref(:'K3', '4F2KQ')->>'resultado') = 'ref_repetido', 'código único por empresa');
ROLLBACK;
