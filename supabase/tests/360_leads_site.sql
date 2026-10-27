-- Leads do site: linhas novas da planilha, repetido em 30 min, número inválido, quem chamou no
-- WhatsApp (antes/depois do cadastro, 9º dígito), ligação com o CRM sem trocar o que já existe,
-- técnico não vê, aviso só no app nunca vai para o WhatsApp. Dados fictícios.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
-- Horário relativo: ontem às 10:00 + N minutos (a conferência olha só os últimos 30 dias).
CREATE FUNCTION pg_temp.t(_min int) RETURNS timestamptz LANGUAGE sql AS $$
  SELECT date_trunc('day', now()) - interval '14 hours' + make_interval(mins => _min);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

-- JSON com "@N@" trocado pelo horário pg_temp.t(N).
CREATE FUNCTION pg_temp.j(_txt text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE m text[];
BEGIN
  FOR m IN SELECT regexp_matches(_txt, '@(-?\d+)@', 'g') LOOP
    _txt := replace(_txt, '@' || m[1] || '@', to_char(pg_temp.t(m[1]::int) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  END LOOP;
  RETURN _txt::jsonb;
END $$;

-- Configuração: tudo desligado, 15 min, 8h às 20h, aviso em 10 min.
INSERT INTO public.leads_site_configuracoes (empresa_id) VALUES ('11111111-1111-1111-1111-111111111111');
SELECT pg_temp.ok((SELECT NOT envio_ligado AND envio_apos_minutos = 5 AND envio_24h AND aviso_minutos = 10
                     AND envio_hora_inicio = '08:00' AND envio_hora_fim = '20:00'
                     AND envio_modelo = 'tc_lead_site' AND envio_ativado_em IS NULL
                     FROM public.leads_site_configuracoes), 'envio começa desligado (5 min, 24 h)');

INSERT INTO public.leads_site_planilhas (id, empresa_id, nome, planilha_id) VALUES
  ('a3600000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'LP Teste', 'planilha-teste-0000000000001');
DO $$ BEGIN
  INSERT INTO public.leads_site_planilhas (empresa_id, nome, planilha_id)
  VALUES ('11111111-1111-1111-1111-111111111111', 'LP ruim', 'https://docs.google.com/x');
  RAISE EXCEPTION 'FALHOU: aceitou link no lugar do id da planilha';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- Contatos e mensagens (fictícios). Lead A escreveu 30 min ANTES do cadastro (conta);
-- lead F escreveu 2 h antes (não conta); lead G tem o contato salvo sem o 9 e escreveu depois.
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone) VALUES
  ('b3600000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '5511987650001'),
  ('b3600000-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111', '5511987650006'),
  ('b3600000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', '551187650007');
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, direction, message_timestamp) VALUES
  ('11111111-1111-1111-1111-111111111111', 'b3600000-0000-0000-0000-00000000000a', 'Recebida', pg_temp.t(-30)),
  ('11111111-1111-1111-1111-111111111111', 'b3600000-0000-0000-0000-00000000000f', 'Recebida', pg_temp.t(-120)),
  ('11111111-1111-1111-1111-111111111111', 'b3600000-0000-0000-0000-00000000000f', 'Enviada', pg_temp.t(30)),
  ('11111111-1111-1111-1111-111111111111', 'b3600000-0000-0000-0000-000000000009', 'Recebida', pg_temp.t(40));
-- Lead do CRM de A, com origem e utm_term que não podem mudar.
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, source_type, utm_term)
VALUES ('c3600000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Pessoa A',
        '11987650001', '5511987650001', 'google', 'termo antigo');

SELECT pg_temp.ok(
  (SELECT (public.leads_site_registrar('a3600000-0000-0000-0000-000000000001', pg_temp.j('[
    {"linha": 2, "cadastrado_em": "@0@", "nome": "Pessoa A", "telefone_digitado": "11987650001", "telefone": "5511987650001", "utm_term": "termo novo", "gclid": "gclid-a"},
    {"linha": 3, "cadastrado_em": "@5@", "nome": "Pessoa B", "telefone_digitado": "1198765", "telefone": null},
    {"linha": 4, "cadastrado_em": "@20@", "nome": "Pessoa A", "telefone_digitado": "11987650001", "telefone": "5511987650001"},
    {"linha": 5, "cadastrado_em": "@60@", "nome": "Pessoa A", "telefone_digitado": "11987650001", "telefone": "5511987650001"},
    {"linha": 6, "cadastrado_em": "@10@", "nome": "Pessoa F", "telefone_digitado": "11987650006", "telefone": "5511987650006"},
    {"linha": 7, "cadastrado_em": "@15@", "nome": "Pessoa G", "telefone_digitado": "11987650007", "telefone": "5511987650007"}
  ]'), 7))->>'novos')::int = 6, 'seis linhas novas');
SELECT pg_temp.ok((SELECT ultima_linha FROM public.leads_site_planilhas) = 7, 'guardou a última linha lida');
-- Ler de novo as mesmas linhas não duplica.
SELECT pg_temp.ok(
  (SELECT (public.leads_site_registrar('a3600000-0000-0000-0000-000000000001',
     pg_temp.j('[{"linha": 2, "cadastrado_em": "@0@", "telefone_digitado": "11987650001", "telefone": "5511987650001"}]'), 7))->>'novos')::int = 0,
  'linha já lida não entra de novo');
SELECT pg_temp.ok((SELECT situacao FROM public.leads_site WHERE linha = 3) = 'invalido', 'número inválido');
SELECT pg_temp.ok((SELECT repetido_de = (SELECT id FROM public.leads_site WHERE linha = 2)
                     FROM public.leads_site WHERE linha = 4), 'mesmo telefone em 20 min é repetido');
SELECT pg_temp.ok((SELECT repetido_de IS NULL FROM public.leads_site WHERE linha = 5), 'depois de 30 min é cadastro novo');

SELECT pg_temp.ok(((public.leads_site_atualizar('11111111-1111-1111-1111-111111111111'))->>'chamaram')::int = 2,
  'A (30 min antes do cadastro) e G (9º dígito) chamaram');
SELECT pg_temp.ok((SELECT situacao FROM public.leads_site WHERE linha = 5) = 'nao_chamou',
  'A de novo 1 h depois: a mensagem foi mais de 1 h antes deste cadastro');
SELECT pg_temp.ok((SELECT situacao = 'chamou' AND chamou_em = pg_temp.t(-30)
                          AND crm_lead_id = 'c3600000-0000-0000-0000-00000000000a'
                     FROM public.leads_site WHERE linha = 2), 'A chamou 30 min antes e ligou ao lead do CRM');
SELECT pg_temp.ok((SELECT situacao FROM public.leads_site WHERE linha = 4) = 'chamou', 'repetido segue a original que chamou (27/10)');
SELECT pg_temp.ok((SELECT situacao FROM public.leads_site WHERE linha = 6) = 'nao_chamou', 'F escreveu 2 h antes: não conta');
SELECT pg_temp.ok((SELECT situacao FROM public.leads_site WHERE linha = 7) = 'chamou', 'G sem o 9 no contato: chamou');
SELECT pg_temp.ok((SELECT lp_origem = 'LP Teste' AND utm_term = 'termo antigo' AND gclid = 'gclid-a'
                          AND source_type = 'google'
                     FROM public.crm_leads WHERE id = 'c3600000-0000-0000-0000-00000000000a'),
  'CRM: LP e gclid preenchidos, utm_term e origem que já existiam ficaram');

-- Alguém apagou as linhas 3 a 6 e entrou um cadastro novo: a aba agora tem 4 linhas (menos que
-- as 7 lidas). A leitura confere tudo pela chave: nada duplica e o novo entra.
SELECT pg_temp.ok(
  (SELECT (public.leads_site_registrar('a3600000-0000-0000-0000-000000000001', pg_temp.j('[
    {"linha": 2, "cadastrado_em": "@0@", "nome": "Pessoa A", "telefone_digitado": "11987650001", "telefone": "5511987650001"},
    {"linha": 3, "cadastrado_em": "@15@", "nome": "Pessoa G", "telefone_digitado": "11987650007", "telefone": "5511987650007"},
    {"linha": 4, "cadastrado_em": "@90@", "nome": "Pessoa H", "telefone_digitado": "11987650008", "telefone": "5511987650008"},
    {"linha": 5, "cadastrado_em": "@95@", "nome": "TESTE da LP", "telefone_digitado": "11912345678", "telefone": "5511912345678"}
  ]'), 5))->>'novos')::int = 1, 'aba encurtada: só o cadastro novo entra (teste ignorado)');
SELECT pg_temp.ok((SELECT count(*) FROM public.leads_site) = 7, 'nenhum duplicado');
SELECT pg_temp.ok((SELECT count(*) FROM public.leads_site WHERE nome ILIKE 'teste%') = 0, 'cadastro de teste ignorado');
SELECT pg_temp.ok((SELECT ultima_linha FROM public.leads_site_planilhas) = 5, 'tamanho atual da aba');
-- Linha inserida no meio (a linha antiga muda de número; a chave não).
SELECT pg_temp.ok(
  (SELECT (public.leads_site_registrar('a3600000-0000-0000-0000-000000000001', pg_temp.j('[
    {"linha": 2, "cadastrado_em": "@0@", "nome": "Pessoa A", "telefone_digitado": "11987650001", "telefone": "5511987650001"},
    {"linha": 3, "cadastrado_em": "@50@", "nome": "Pessoa I", "telefone_digitado": "11987650009", "telefone": "5511987650009"},
    {"linha": 4, "cadastrado_em": "@15@", "nome": "Pessoa G", "telefone_digitado": "11987650007", "telefone": "5511987650007"},
    {"linha": 5, "cadastrado_em": "@90@", "nome": "Pessoa H", "telefone_digitado": "11987650008", "telefone": "5511987650008"}
  ]'), 5))->>'novos')::int = 1, 'linha inserida no meio entra; as outras não duplicam');

-- Cadastro apagado do app (chave na lista de ignorados) não volta na próxima leitura.
UPDATE public.leads_site_planilhas
   SET chaves_ignoradas = ARRAY[(SELECT chave FROM public.leads_site WHERE nome = 'Pessoa H')];
SELECT pg_temp.ok((SELECT count(*) FROM public.leads_site WHERE nome = 'Pessoa H') = 1, 'Pessoa H existe');
CREATE TEMP TABLE apagados AS SELECT id FROM public.leads_site WHERE nome = 'Pessoa H';
UPDATE public.leads_site SET repetido_de = NULL WHERE repetido_de IN (SELECT id FROM apagados);
DELETE FROM public.leads_site WHERE id IN (SELECT id FROM apagados);
SELECT pg_temp.ok(
  (SELECT (public.leads_site_registrar('a3600000-0000-0000-0000-000000000001', pg_temp.j('[
    {"linha": 5, "cadastrado_em": "@90@", "nome": "Pessoa H", "telefone_digitado": "11987650008", "telefone": "5511987650008"}
  ]'), 5))->>'novos')::int = 0, 'cadastro apagado do app não volta');

-- Aviso só no app: o envio para o WhatsApp não consegue marcar como enviado.
INSERT INTO public.mkt_avisos (id, empresa_id, tipo, titulo, mensagem, so_no_app)
VALUES ('d3600000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'lead_site_sem_chamar', 'Lead do site', 'teste', true);
DO $$ BEGIN
  UPDATE public.mkt_avisos SET whatsapp_enviado_em = now() WHERE id = 'd3600000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FALHOU: aviso só no app marcado como enviado no WhatsApp';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- Quem vê: admin e atendente sim; técnico não. Ninguém grava pela tela.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000361', 'atendente@leads.dev'),
  ('00000000-0000-0000-0000-000000000362', 'tecnico@leads.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES
  ('00000000-0000-0000-0000-000000000361', '11111111-1111-1111-1111-111111111111', 'atendente'),
  ('00000000-0000-0000-0000-000000000362', '11111111-1111-1111-1111-111111111111', 'tecnico');
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.leads_site', 'UPDATE'), 'tela não grava');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.leads_site_registrar(uuid, jsonb, int)', 'EXECUTE'), 'só o servidor registra');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000361","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.leads_site) = 7, 'atendente vê os leads do site');
SELECT pg_temp.ok((SELECT count(*) FROM public.leads_site_planilhas) = 1, 'atendente vê as planilhas');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000362","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.leads_site) = 0, 'técnico não vê leads do site');
SELECT pg_temp.ok((SELECT count(*) FROM public.leads_site_planilhas) = 0, 'técnico não vê planilhas');
SELECT pg_temp.ok((SELECT count(*) FROM public.leads_site_configuracoes) = 0, 'técnico não vê configuração');
RESET ROLE;

ROLLBACK;
