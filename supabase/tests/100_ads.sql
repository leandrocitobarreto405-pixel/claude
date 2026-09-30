-- Google Ads: captação do pop-up (domínio, validação, idempotência, limite por IP), vínculo com o
-- lead (inclusive sem o 9º dígito), WhatsApp iniciado, conversões para o Google e isolamento.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

CREATE FUNCTION pg_temp.clique(_host text, _ip text, _dados jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.ads_registrar_clique(_host, _ip, _dados);
$$;

CREATE FUNCTION pg_temp.msg(_id int, _conversa int, _fone text, _quando text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.receber_evento_chatwoot('token-ads', 'a' || _id, jsonb_build_object(
    'event', 'message_created', 'id', _id, 'message_type', 'incoming', 'content', 'Oi, vim do anúncio',
    'private', false, 'created_at', _quando,
    'account', jsonb_build_object('id', 187966), 'inbox', jsonb_build_object('id', 12),
    'sender', jsonb_build_object('id', 700 + _conversa, 'type', 'contact'),
    'conversation', jsonb_build_object('id', _conversa, 'inbox_id', 12, 'status', 'open',
      'channel', 'Channel::Whatsapp',
      'meta', jsonb_build_object('sender', jsonb_build_object('id', 700 + _conversa,
        'name', 'Cliente ' || _conversa, 'phone_number', _fone)))));
$$;

INSERT INTO public.empresas (id, nome) VALUES ('22222222-2222-2222-2222-222222222222', 'Cliente B');
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('77777777-7777-7777-7777-777777777777', 'Nexa', 187966, 'token-ads');
INSERT INTO public.chatwoot_inboxes (conexao_id, inbox_id, empresa_id) VALUES
  ('77777777-7777-7777-7777-777777777777', 12, '11111111-1111-1111-1111-111111111111');
INSERT INTO public.ads_dominios (dominio, empresa_id) VALUES
  ('turbinecleanimper.lovable.app', '11111111-1111-1111-1111-111111111111'),
  ('turbineclanhigenizacao.lovable.app', '11111111-1111-1111-1111-111111111111'),
  ('landing-b.example.com', '22222222-2222-2222-2222-222222222222');

-- 0. Telefone: mesma normalização do CRM; chave ignora o 9º dígito.
SELECT pg_temp.ok(private.telefone_chave('5511969359207') = private.telefone_chave('551169359207'),
  'chave igual com e sem o 9');
SELECT pg_temp.ok(private.telefone_chave('5511969359207') <> private.telefone_chave('5521969359207'),
  'DDD diferente, chave diferente');
DO $$ BEGIN
  INSERT INTO public.ads_dominios (dominio, empresa_id) VALUES ('https://x.com/', '11111111-1111-1111-1111-111111111111');
  RAISE EXCEPTION 'FALHOU: aceitou domínio com protocolo';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- 1. Domínio desconhecido: nada gravado, evento registrado.
SELECT pg_temp.ok(pg_temp.clique('outro-site.com', 'ip1', '{"telefone":"11 96935-9207"}')->>'resultado'
  = 'dominio_desconhecido', 'domínio desconhecido');
SELECT pg_temp.ok((SELECT count(*) FROM public.ads_clicks) = 0, 'nada gravado');

-- 2. Telefone inválido: não grava, devolve o motivo.
SELECT pg_temp.ok(pg_temp.clique('turbinecleanimper.lovable.app', 'ip1', '{"telefone":"123"}')->>'resultado'
  = 'invalido', 'telefone curto é inválido');

-- 3. Envio válido: grava normalizado, serviço pela landing, gclid estranho descartado com aviso.
CREATE TEMP TABLE r3 AS SELECT pg_temp.clique('turbinecleanimper.lovable.app', 'ip1', jsonb_build_object(
  'nome', '  Ana  ', 'telefone', '(11) 96935-9207', 'gclid', 'Cj0KCQ_abc-123', 'gbraid', 'x y<script>',
  'utm_source', 'google', 'utm_campaign', 'imper-sp', 'page_url', 'https://turbinecleanimper.lovable.app/?gclid=Cj0KCQ_abc-123')) AS v;
SELECT pg_temp.ok((SELECT v->>'resultado' FROM r3) = 'gravado', 'gravado: ' || (SELECT v::text FROM r3));
SELECT pg_temp.ok((SELECT nome || '|' || normalized_phone || '|' || servico || '|' || gclid || '|' || coalesce(gbraid, '-')
    FROM public.ads_clicks WHERE id = (SELECT (v->>'id')::uuid FROM r3))
  = 'Ana|5511969359207|impermeabilizacao|Cj0KCQ_abc-123|-', 'campos limpos e normalizados');
SELECT pg_temp.ok((SELECT v->'avisos' FROM r3) ? 'gbraid descartado', 'aviso do gbraid');

-- 4. Idempotente: mesmo telefone + gclid na mesma hora (outro formato do número).
SELECT pg_temp.ok((pg_temp.clique('turbinecleanimper.lovable.app', 'ip1',
    '{"telefone":"5511969359207","gclid":"Cj0KCQ_abc-123"}')->>'id') = (SELECT v->>'id' FROM r3),
  'reenvio devolve o mesmo registro');
SELECT pg_temp.ok((SELECT count(*) FROM public.ads_clicks) = 1, 'sem duplicar');
-- Outro gclid = outro clique.
SELECT pg_temp.clique('turbineclanhigenizacao.lovable.app', 'ip2',
  '{"telefone":"11 98888-7777","gclid":"GCLID_B_000","servico":"Higienização"}');
SELECT pg_temp.ok((SELECT servico FROM public.ads_clicks WHERE gclid = 'GCLID_B_000') = 'higienizacao',
  'serviço pelo campo');

-- 5. Limite por IP: 20 envios em 10 minutos.
DO $$ BEGIN
  FOR i IN 1..25 LOOP
    PERFORM public.ads_registrar_clique('turbinecleanimper.lovable.app', 'ip-spam',
      jsonb_build_object('telefone', '119' || lpad(i::text, 8, '0')));
  END LOOP;
END $$;
SELECT pg_temp.ok((SELECT count(*) FROM public.ads_eventos WHERE ip_hash = 'ip-spam' AND resultado = 'limite') = 5,
  'limite por IP');
DELETE FROM public.ads_clicks WHERE normalized_phone LIKE '55119000%';

-- 6. Lead criado pelo WhatsApp (número SEM o 9): liga ao clique e marca o WhatsApp iniciado.
SELECT pg_temp.msg(1, 501, '+551169359207', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
SELECT pg_temp.ok((SELECT crm_lead_id IS NOT NULL AND vinculado_em IS NOT NULL AND whatsapp_iniciado_em IS NOT NULL
    FROM public.ads_clicks WHERE gclid = 'Cj0KCQ_abc-123'), 'lead do WhatsApp vinculado e WhatsApp iniciado');
SELECT pg_temp.ok((SELECT a.crm_lead_id = c.crm_lead_id FROM public.ads_clicks a, public.conversas c
    WHERE a.gclid = 'Cj0KCQ_abc-123' AND c.chatwoot_conversation_id = 501), 'é o lead da conversa');
SELECT pg_temp.ok((SELECT count(*) FROM public.ads_eventos WHERE tipo IN ('vinculo', 'whatsapp')) = 2,
  'vínculo e WhatsApp registrados no log');

-- 7. Lead criado à mão com outro telefone e depois corrigido: vincula na troca do telefone.
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone)
VALUES ('a2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Bia', '11 90000-0000', '5511900000000');
SELECT pg_temp.ok((SELECT crm_lead_id FROM public.ads_clicks WHERE gclid = 'GCLID_B_000') IS NULL, 'telefone errado não liga');
UPDATE public.crm_leads SET phone = '11 98888-7777', normalized_phone = '5511988887777'
 WHERE id = 'a2000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT crm_lead_id FROM public.ads_clicks WHERE gclid = 'GCLID_B_000') = 'a2000000-0000-0000-0000-000000000001',
  'telefone corrigido liga o clique');

-- 8. Pop-up depois do lead existir: liga na hora.
SELECT pg_temp.clique('turbineclanhigenizacao.lovable.app', 'ip3', '{"telefone":"11988887777","gclid":"GCLID_B_111"}');
SELECT pg_temp.ok((SELECT crm_lead_id FROM public.ads_clicks WHERE gclid = 'GCLID_B_111') = 'a2000000-0000-0000-0000-000000000001',
  'clique novo de lead existente');

-- 9. Conversões: só venda faturada com gclid, uma por lead, formato do Google.
SELECT pg_temp.ok((SELECT count(*) FROM public.vw_conversoes_google) = 0, 'sem venda, sem conversão');
UPDATE public.ads_clicks SET created_at = now() - interval '3 days' WHERE gclid IN ('Cj0KCQ_abc-123', 'GCLID_B_000');
UPDATE public.ads_clicks SET created_at = now() - interval '2 days' WHERE gclid = 'GCLID_B_111';
INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Bia', '11988887777');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date)
VALUES ('e2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '9101',
        'c2000000-0000-0000-0000-000000000001', 459.90, current_date);
UPDATE public.crm_leads SET linked_work_order_id = 'e2000000-0000-0000-0000-000000000001'
 WHERE id = 'a2000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT count(*) FROM public.vw_conversoes_google) = 0, 'OS sem pagamento não é venda');
INSERT INTO public.payments (empresa_id, work_order_id, payment_channel, payment_date, gross_amount,
  net_amount, payment_status, is_active)
VALUES ('11111111-1111-1111-1111-111111111111', 'e2000000-0000-0000-0000-000000000001', 'Pix',
        current_date - 1, 459.90, 459.90, 'Pago', true);
SELECT pg_temp.ok((SELECT count(*) FROM public.vw_conversoes_google) = 1,
  'uma conversão por venda: ' || (SELECT count(*) FROM public.vw_conversoes_google));
SELECT pg_temp.ok((SELECT "Google Click ID" || '|' || "Conversion Name" || '|' || "Conversion Value" || '|' || "Conversion Currency"
    FROM public.vw_conversoes_google) = 'GCLID_B_111|Venda Higienização|459.90|BRL',
  'clique mais recente, nome, valor e moeda: ' || (SELECT row_to_json(v)::text FROM public.vw_conversoes_google v));
SELECT pg_temp.ok((SELECT "Conversion Time" FROM public.vw_conversoes_google)
    = to_char(current_date - 1, 'YYYY-MM-DD') || ' 12:00:00-03:00',
  'horário do faturamento: ' || (SELECT "Conversion Time" FROM public.vw_conversoes_google));
SELECT pg_temp.ok((SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vw_conversoes_google')
  = 'Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency', 'colunas exatas');

-- Pagamento no mesmo dia, depois do clique: conversão 1 minuto depois do clique.
UPDATE public.ads_clicks SET created_at = (current_date - 1 + time '15:00') AT TIME ZONE 'America/Sao_Paulo'
 WHERE gclid = 'GCLID_B_111';
SELECT pg_temp.ok((SELECT "Conversion Time" FROM public.vw_conversoes_google)
    = to_char(current_date - 1, 'YYYY-MM-DD') || ' 15:01:00-03:00', 'conversão depois do clique');

-- 10. Enviada: sai da view; clique novo do mesmo lead não gera outra conversão.
UPDATE public.ads_clicks SET enviado_google_em = now() WHERE gclid = 'GCLID_B_111';
SELECT pg_temp.ok((SELECT count(*) FROM public.vw_conversoes_google) = 0, 'lead já enviado não volta');

-- 11. Isolamento: usuário da empresa B não vê cliques nem conversões da Turbine.
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000b9', 'b@ads.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
VALUES ('00000000-0000-0000-0000-0000000000b9', '22222222-2222-2222-2222-222222222222', 'admin');
UPDATE public.ads_clicks SET enviado_google_em = NULL WHERE gclid = 'GCLID_B_111';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b9","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.ads_clicks) = 0, 'B não vê cliques da Turbine');
SELECT pg_temp.ok((SELECT count(*) FROM public.vw_conversoes_google) = 0, 'B não vê conversões da Turbine');
SELECT pg_temp.ok((SELECT count(*) FROM public.ads_eventos) = 0, 'B não vê o log da Turbine');
DO $$ BEGIN
  PERFORM public.ads_registrar_clique('landing-b.example.com', 'x', '{"telefone":"11999998888"}');
  RAISE EXCEPTION 'FALHOU: usuário chamou a captação';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;

-- 12. Fase 2 não liga sem modelo de mensagem.
DO $$ BEGIN
  INSERT INTO public.ads_configuracoes (empresa_id, alice_iniciar_conversa)
  VALUES ('11111111-1111-1111-1111-111111111111', true);
  RAISE EXCEPTION 'FALHOU: ligou a fase 2 sem modelo';
EXCEPTION WHEN check_violation THEN NULL; END $$;

ROLLBACK;
