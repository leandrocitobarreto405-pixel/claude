-- Testes da origem dos leads (identificação automática) e do nome do lead vindo do Chatwoot.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

-- Conversa nova no formato do webhook, com a primeira mensagem do cliente.
CREATE FUNCTION pg_temp.conversa(_display int, _inbox int, _contato int, _fone text, _nome text,
  _texto text, _canal text DEFAULT 'Channel::Whatsapp', _atributos jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'event', 'conversation_created', 'id', _display, 'inbox_id', _inbox, 'status', 'open',
    'channel', _canal, 'account', jsonb_build_object('id', 187966),
    'meta', jsonb_build_object('sender', jsonb_build_object('id', _contato, 'name', _nome, 'phone_number', _fone)),
    'additional_attributes', _atributos,
    'messages', jsonb_build_array(jsonb_build_object('id', _display * 100, 'content', _texto, 'message_type', 0)),
    'created_at', 1790000000, 'updated_at', 1790000000 + _display, 'last_activity_at', 1790000000);
$$;

CREATE FUNCTION pg_temp.mensagem(_id int, _display int, _inbox int, _contato int, _fone text, _texto text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'event', 'message_created', 'id', _id, 'message_type', 'incoming', 'content', _texto,
    'private', false, 'created_at', '2026-09-27T12:00:00Z',
    'account', jsonb_build_object('id', 187966), 'inbox', jsonb_build_object('id', _inbox),
    'sender', jsonb_build_object('id', _contato, 'name', 'x', 'phone_number', _fone),
    'conversation', jsonb_build_object('id', _display, 'inbox_id', _inbox, 'status', 'open',
      'channel', 'Channel::Whatsapp',
      'meta', jsonb_build_object('sender', jsonb_build_object('id', _contato, 'phone_number', _fone))));
$$;

CREATE FUNCTION pg_temp.receber(_p jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.receber_evento_chatwoot('token-origem', 'd', _p);
$$;

CREATE FUNCTION pg_temp.origem(_fone text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(o.name, '(nenhuma)') || CASE WHEN l.origem_automatica THEN ' [auto]' ELSE '' END
    FROM public.crm_leads l LEFT JOIN public.config_options o ON o.id = l.sales_origin_id
   WHERE l.normalized_phone = _fone ORDER BY l.created_at DESC LIMIT 1;
$$;

-- ---------------------------------------------------------------- cenário (Turbine = 111…)
INSERT INTO public.empresas (id, nome) VALUES ('22222222-2222-2222-2222-222222222222', 'Cliente B');
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('33333333-3333-3333-3333-333333333333', 'Nexa', 187966, 'token-origem');
INSERT INTO public.chatwoot_inboxes (conexao_id, inbox_id, empresa_id) VALUES
  ('33333333-3333-3333-3333-333333333333', 12, '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333', 34, '22222222-2222-2222-2222-222222222222');
INSERT INTO public.customers (empresa_id, full_name, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'Cliente antigo', '(11) 97000-0005');

-- Lista padrão de origens da empresa.
SELECT pg_temp.ok((SELECT string_agg(name, ' | ' ORDER BY display_order) FROM public.config_options
  WHERE empresa_id = '11111111-1111-1111-1111-111111111111' AND kind = 'sales_origin')
  = 'Google | Instagram | Facebook | Indicação | Blog | Cliente existente / Recorrência | Outra origem',
  'origens padrão na ordem');

-- 1. Palavras-chave na primeira mensagem.
SELECT pg_temp.receber(pg_temp.conversa(1, 12, 1, '+5511970000001', 'Ana', 'Olá! Vim pelo Google, quero orçamento'));
SELECT pg_temp.ok(pg_temp.origem('5511970000001') = 'Google [auto]', 'Google pela mensagem');

SELECT pg_temp.receber(pg_temp.conversa(2, 12, 2, '+5511970000002', 'Bia', 'Oi, minha vizinha me INDICOU vocês'));
SELECT pg_temp.ok(pg_temp.origem('5511970000002') = 'Indicação [auto]', 'Indicação sem diferenciar maiúsculas');

SELECT pg_temp.receber(pg_temp.conversa(3, 12, 3, '+5511970000003', 'Caio', 'Queria saber da instalação e do preço'));
SELECT pg_temp.ok(pg_temp.origem('5511970000003') = '(nenhuma)', 'sem palavra-chave: origem em branco (nada de "insta" em instalação)');

-- 2. Cliente existente tem prioridade.
SELECT pg_temp.receber(pg_temp.conversa(5, 12, 5, '+5511970000005', 'Duda', 'Vim pelo Google'));
SELECT pg_temp.ok(pg_temp.origem('5511970000005') = 'Cliente existente / Recorrência [auto]', 'telefone de cliente cadastrado');

-- 3. Canal Instagram e anúncio "clique para WhatsApp".
SELECT pg_temp.receber(pg_temp.conversa(6, 12, 6, '+5511970000006', 'Edu', 'Oi', 'Channel::Instagram'));
SELECT pg_temp.ok(pg_temp.origem('5511970000006') = 'Instagram [auto]', 'caixa do Instagram');
SELECT pg_temp.receber(pg_temp.conversa(7, 12, 7, '+5511970000007', 'Fabi', 'Oi', 'Channel::Whatsapp',
  '{"referral": {"source_type": "ad", "source_url": "https://fb.me/abc"}}'));
SELECT pg_temp.ok(pg_temp.origem('5511970000007') = 'Facebook [auto]', 'anúncio do Facebook');

-- 4. Lead sem origem ganha origem numa mensagem seguinte; origem manual não é trocada.
SELECT pg_temp.receber(pg_temp.mensagem(3001, 3, 12, 3, '+5511970000003', 'Achei vocês no blog de vocês'));
SELECT pg_temp.ok(pg_temp.origem('5511970000003') = 'Blog [auto]', 'origem identificada depois');
UPDATE public.crm_leads SET sales_origin_id = (SELECT id FROM public.config_options
  WHERE empresa_id = '11111111-1111-1111-1111-111111111111' AND kind = 'sales_origin' AND name = 'Outra origem'),
  origem_automatica = false WHERE normalized_phone = '5511970000003';
SELECT pg_temp.receber(pg_temp.mensagem(3002, 3, 12, 3, '+5511970000003', 'vim pelo google também'));
SELECT pg_temp.ok(pg_temp.origem('5511970000003') = 'Outra origem', 'origem manual é mantida');

-- 5. Palavras editáveis pela empresa.
UPDATE public.config_options SET metadata = jsonb_set(metadata, '{palavras}', '["blog", "vi no site"]')
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111' AND kind = 'sales_origin' AND name = 'Blog';
SELECT pg_temp.receber(pg_temp.conversa(8, 12, 8, '+5511970000008', 'Gil', 'Olá, vi no site o preço'));
SELECT pg_temp.ok(pg_temp.origem('5511970000008') = 'Blog [auto]', 'palavra-chave nova cadastrada pela empresa');

-- 5b. Palavra inteira: "insta" não pega "instalação".
UPDATE public.config_options SET metadata = jsonb_set(metadata, '{palavras}', '["instagram", "insta"]')
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111' AND kind = 'sales_origin' AND name = 'Instagram';
SELECT pg_temp.receber(pg_temp.conversa(10, 12, 10, '+5511970000010', 'Ivo', 'Preciso de uma instalação'));
SELECT pg_temp.ok(pg_temp.origem('5511970000010') = '(nenhuma)', 'palavra dentro de outra não conta');
SELECT pg_temp.receber(pg_temp.conversa(12, 12, 12, '+5511970000012', 'Lu', 'Achei no meublog'));
SELECT pg_temp.ok(pg_temp.origem('5511970000012') = '(nenhuma)', 'palavra no fim de outra não conta');
SELECT pg_temp.receber(pg_temp.conversa(11, 12, 11, '+5511970000011', 'Jo', 'Vi vocês no insta!'));
SELECT pg_temp.ok(pg_temp.origem('5511970000011') = 'Instagram [auto]', 'palavra inteira conta');

-- 6. Isolamento: a empresa B não tem as origens da Turbine.
DELETE FROM public.config_options WHERE empresa_id = '22222222-2222-2222-2222-222222222222' AND kind = 'sales_origin';
SELECT pg_temp.receber(pg_temp.conversa(9, 34, 9, '+5511970000009', 'Hugo', 'Vim pelo Google'));
SELECT pg_temp.ok((SELECT count(*) FROM public.crm_leads WHERE empresa_id = '22222222-2222-2222-2222-222222222222'
  AND sales_origin_id IS NULL) = 1, 'empresa B cria o lead sem origem de outra empresa');

-- 7. Nome do lead acompanha o contato editado no Chatwoot; nome editado à mão é mantido.
SELECT pg_temp.receber(jsonb_build_object('event', 'contact_updated', 'id', 1, 'name', 'Ana Paula Souza',
  'account', jsonb_build_object('id', 187966)));
SELECT pg_temp.ok((SELECT lead_name FROM public.crm_leads WHERE normalized_phone = '5511970000001') = 'Ana Paula Souza',
  'lead renomeado junto com o contato');
UPDATE public.crm_leads SET lead_name = 'Bia (síndica)' WHERE normalized_phone = '5511970000002';
SELECT pg_temp.receber(jsonb_build_object('event', 'contact_updated', 'id', 2, 'name', 'Beatriz Lima',
  'account', jsonb_build_object('id', 187966)));
SELECT pg_temp.ok((SELECT lead_name FROM public.crm_leads WHERE normalized_phone = '5511970000002') = 'Bia (síndica)',
  'nome editado à mão não é sobrescrito');
SELECT pg_temp.ok((SELECT profile_name FROM public.whatsapp_contacts WHERE chatwoot_contact_id = 2) = 'Beatriz Lima',
  'contato recebe o nome novo');

-- 8. Indicadores: origem em branco aparece como "Não identificada" (e nunca o canal).
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000b1', 't@teste.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
VALUES ('00000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'admin');
UPDATE public.crm_leads SET sales_origin_id = NULL WHERE normalized_phone = '5511970000006';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE ind AS SELECT public.indicadores_funil('2026-01-01', '2026-12-31') AS v;
SELECT pg_temp.ok((SELECT count(*) FROM ind, jsonb_array_elements(v->'origens') o
  WHERE o->>'origem' = 'Não identificada') = 1, 'origem vazia = Não identificada');
SELECT pg_temp.ok((SELECT count(*) FROM ind, jsonb_array_elements(v->'origens') o
  WHERE o->>'origem' = 'Chatwoot') = 0, 'canal não aparece como origem');

-- 9. Link da conversa: só para conversas que o usuário vê (nem com uma linha montada à mão).
SELECT pg_temp.ok((SELECT public.url_chatwoot(c) FROM public.conversas c WHERE c.chatwoot_conversation_id = 1)
  LIKE '%/app/accounts/187966/conversations/1', 'link da conversa da própria empresa');
RESET ROLE;
CREATE TEMP TABLE conversa_b AS SELECT * FROM public.conversas WHERE chatwoot_conversation_id = 9;
GRANT SELECT ON conversa_b TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT public.url_chatwoot(jsonb_populate_record(NULL::public.conversas, to_jsonb(c))) FROM conversa_b c) IS NULL,
  'conversa de outra empresa não gera link');
RESET ROLE;

-- 10. Mensagens prontas cadastradas (links de WhatsApp com texto).
INSERT INTO public.config_options (empresa_id, kind, name, display_order)
VALUES ('11111111-1111-1111-1111-111111111111', 'sales_origin', 'Site', 8);
INSERT INTO public.crm_campaigns (id, empresa_id, platform, campaign_name)
VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Google Ads', 'Google — Higienização');
CREATE FUNCTION pg_temp.origem_id(_empresa uuid, _nome text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.config_options WHERE empresa_id = _empresa AND kind = 'sales_origin' AND name = _nome;
$$;
INSERT INTO public.mensagens_origem (empresa_id, texto, sales_origin_id, campaign_id, servico) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Olá, gostaria de um orçamento para higienização dos meus estofados, por favor.',
   pg_temp.origem_id('11111111-1111-1111-1111-111111111111', 'Google'), '44444444-4444-4444-4444-444444444444', 'Higienização'),
  ('11111111-1111-1111-1111-111111111111', 'Olá! Quero um orçamento.',
   pg_temp.origem_id('11111111-1111-1111-1111-111111111111', 'Site'), NULL, NULL),
  ('11111111-1111-1111-1111-111111111111', 'Olá! Quero um orçamento de impermeabilização.',
   pg_temp.origem_id('11111111-1111-1111-1111-111111111111', 'Site'), NULL, 'Impermeabilização');

CREATE FUNCTION pg_temp.lead(_fone text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(o.name, '(nenhuma)') || ' | ' || coalesce(c.campaign_name, '-') || ' | ' || coalesce(l.service_interest, '-')
    FROM public.crm_leads l LEFT JOIN public.config_options o ON o.id = l.sales_origin_id
    LEFT JOIN public.crm_campaigns c ON c.id = l.campaign_id
   WHERE l.normalized_phone = _fone ORDER BY l.created_at DESC LIMIT 1;
$$;

SELECT pg_temp.receber(pg_temp.conversa(20, 12, 20, '+5511970000020', 'Mi',
  'Olá, gostaria de um orçamento para higienização dos meus estofados, por favor.'));
SELECT pg_temp.ok(pg_temp.lead('5511970000020') = 'Google | Google — Higienização | Higienização',
  'mensagem da campanha: origem, campanha e serviço');
SELECT pg_temp.receber(pg_temp.conversa(21, 12, 21, '+5511970000021', 'Nina',
  'olá!! quero um ORCAMENTO de impermeabilizacao'));
SELECT pg_temp.ok(pg_temp.lead('5511970000021') = 'Site | - | Impermeabilização',
  'a mensagem cadastrada mais longa vence; sem acento/pontuação/maiúsculas');
SELECT pg_temp.receber(pg_temp.conversa(22, 12, 22, '+5511970000022', 'Otto', 'Olá! Quero um orçamento.'));
SELECT pg_temp.ok(pg_temp.lead('5511970000022') = 'Site | - | -', 'mensagem curta do site');
INSERT INTO public.customers (empresa_id, full_name, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'Cliente da campanha', '(11) 97000-0023');
SELECT pg_temp.receber(pg_temp.conversa(23, 12, 23, '+5511970000023', 'Pedro',
  'Olá, gostaria de um orçamento para higienização dos meus estofados, por favor.'));
SELECT pg_temp.ok(pg_temp.lead('5511970000023') = 'Cliente existente / Recorrência | Google — Higienização | Higienização',
  'cliente existente mantém a origem, mas grava campanha e serviço');

-- Mensagem de outra empresa não vale para a Turbine; referência cruzada é recusada.
INSERT INTO public.config_options (empresa_id, kind, name) VALUES ('22222222-2222-2222-2222-222222222222', 'sales_origin', 'Google');
INSERT INTO public.mensagens_origem (empresa_id, texto, sales_origin_id)
VALUES ('22222222-2222-2222-2222-222222222222', 'Quero o combo da empresa B',
        pg_temp.origem_id('22222222-2222-2222-2222-222222222222', 'Google'));
SELECT pg_temp.receber(pg_temp.conversa(24, 12, 24, '+5511970000024', 'Quel', 'Quero o combo da empresa B'));
SELECT pg_temp.ok(pg_temp.lead('5511970000024') = '(nenhuma) | - | -', 'mensagem de outra empresa não identifica');
DO $$ BEGIN
  INSERT INTO public.mensagens_origem (empresa_id, texto, sales_origin_id)
  VALUES ('11111111-1111-1111-1111-111111111111', 'x y z', pg_temp.origem_id('22222222-2222-2222-2222-222222222222', 'Google'));
  RAISE EXCEPTION 'FALHOU: aceitou origem de outra empresa';
EXCEPTION WHEN foreign_key_violation THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO public.mensagens_origem (empresa_id, texto, sales_origin_id)
  VALUES ('11111111-1111-1111-1111-111111111111', 'x y z', (SELECT id FROM public.config_options
    WHERE empresa_id = '11111111-1111-1111-1111-111111111111' AND kind = 'crm_status' LIMIT 1));
  RAISE EXCEPTION 'FALHOU: aceitou um status como origem';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO public.mensagens_origem (empresa_id, texto, sales_origin_id)
  VALUES ('11111111-1111-1111-1111-111111111111', 'OLÁ, quero um orçamento!', pg_temp.origem_id('11111111-1111-1111-1111-111111111111', 'Blog'));
  RAISE EXCEPTION 'FALHOU: aceitou mensagem repetida';
EXCEPTION WHEN unique_violation THEN NULL; END $$;

-- 11. Reaplicar aos leads sem origem (pelo app, com o RLS da empresa).
SELECT pg_temp.receber(pg_temp.conversa(25, 12, 25, '+5511970000025', 'Rui', 'Oi, vi a promoção de primavera'));
SELECT pg_temp.receber(pg_temp.mensagem(2501, 25, 12, 25, '+5511970000025', 'Oi, vi a promoção de primavera'));
SELECT pg_temp.ok(pg_temp.lead('5511970000025') = '(nenhuma) | - | -', 'antes do cadastro: sem origem');
INSERT INTO public.mensagens_origem (empresa_id, texto, sales_origin_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'vi a promoção de primavera', pg_temp.origem_id('11111111-1111-1111-1111-111111111111', 'Site'));
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.mensagens_origem WHERE empresa_id <> '11111111-1111-1111-1111-111111111111') = 0,
  'usuário só vê as mensagens da própria empresa');
SELECT pg_temp.ok(public.testar_origem_mensagem('Olá! Quero um orçamento de impermeabilização.')
  = '{"origem": "Site", "campanha": null, "servico": "Impermeabilização"}'::jsonb, 'testar mensagem');
SELECT pg_temp.ok(public.testar_origem_mensagem('Quero o combo da empresa B')->>'origem' IS NULL,
  'testar não usa mensagens de outra empresa');
CREATE TEMP TABLE reaplicados AS SELECT public.reaplicar_origem_leads() AS n;
RESET ROLE;
SELECT pg_temp.ok((SELECT n FROM reaplicados) >= 1, 'reaplicar atualizou leads');
SELECT pg_temp.ok(pg_temp.lead('5511970000025') = 'Site | - | -', 'lead antigo ganhou a origem');
SELECT pg_temp.ok(pg_temp.origem('5511970000003') = 'Outra origem', 'reaplicar não troca origem manual');
SELECT pg_temp.ok(pg_temp.lead('5511970000024') = '(nenhuma) | - | -', 'reaplicar não usa mensagem de outra empresa');

ROLLBACK;
