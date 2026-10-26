-- Franquia da Alice (migração 20261217120000): conversa conta quando a Alice manda a primeira
-- mensagem do mês; na franquia a conversa nova vai para a equipe; "continuar" até o teto em R$;
-- conversa acima de R$ 5 vai para a equipe; plano que não trava só mede; avisos em 80% e 100%.
-- Dados fictícios (franquia de 5 conversas num plano de teste).
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.como(_email text, _empresa uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false),
         set_config('request.headers', json_build_object('x-empresa-id', _empresa)::text, false);
$$;
-- Resposta da Alice (msgs vazio = não respondeu; custo em dólar); cria a conversa se faltar.
CREATE FUNCTION pg_temp.resposta(_emp uuid, _conversa uuid, _msgs text[], _custo numeric DEFAULT 0.05)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.conversas (id, empresa_id, conexao_id, chatwoot_conversation_id, status)
  VALUES (_conversa, _emp, '73000000-0000-4000-8000-0000000000ff',
          ('x' || substr(md5(_conversa::text), 1, 8))::bit(32)::int & 2147483647, 'pending')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.ia_execucoes (empresa_id, conversa_id, modelo, custo_usd, mensagens_enviadas)
  VALUES (_emp, _conversa, 'claude-sonnet-5-5', _custo, _msgs);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;
\set P '73000000-0000-4000-8000-000000000001'
\set L '73000000-0000-4000-8000-000000000002'

SELECT pg_temp.ok((SELECT alice_conversas_incluidas = 150 AND alice_preco_excedente = 3.50 AND alice_trava_franquia
                     FROM public.planos WHERE codigo = 'profissional_alice'), 'Profissional + Alice: 150, R$ 3,50, trava');
SELECT pg_temp.ok((SELECT bool_and(alice_conversas_incluidas = 150 AND NOT alice_trava_franquia)
                     FROM public.planos WHERE codigo IN ('nexa_gestao', 'interna')), 'Nexa Gestão e Interna só medem');

INSERT INTO public.planos (codigo, nome, preco_mensal, recursos, ordem, alice_conversas_incluidas, alice_preco_excedente, alice_trava_franquia)
VALUES ('teste_franquia', 'Teste franquia', 497, '{"alice": true}', 99, 5, 3.50, true),
       ('teste_livre', 'Teste livre', 0, '{"alice": true}', 99, 5, NULL, false);
INSERT INTO public.empresas (id, nome) VALUES (:'P', 'Franquia 730'), (:'L', 'Livre 730');
INSERT INTO public.assinaturas (empresa_id, plano_id, status, vigencia_inicio)
SELECT :'P', id, 'ativa', private.hoje_sp() - 10 FROM public.planos WHERE codigo = 'teste_franquia';
INSERT INTO public.assinaturas (empresa_id, plano_id, status, vigencia_inicio)
SELECT :'L', id, 'ativa', private.hoje_sp() - 10 FROM public.planos WHERE codigo = 'teste_livre';
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('73000000-0000-4000-8000-0000000000ff', 'Conexão 730', 730730, 'token-730');
INSERT INTO public.ia_configuracoes (empresa_id, ativo, nome, instrucoes, perguntas_frequentes)
VALUES (:'P', false, 'Alice', 'r', ''), (:'L', false, 'Alice', 'r', '');

-- Conta só quando a Alice mandou mensagem; texto interno retido e erro não contam.
SELECT pg_temp.resposta(:'P', '73000000-0000-4000-8000-0000000000a1', ARRAY['[não enviado: texto interno] x']);
SELECT pg_temp.ok((SELECT primeira_resposta_em IS NULL AND custo_usd = 0.05 FROM public.alice_uso_mensal
                    WHERE conversa_id = '73000000-0000-4000-8000-0000000000a1'), 'texto interno não conta, custo soma');
SELECT pg_temp.resposta(:'P', '73000000-0000-4000-8000-0000000000a1', ARRAY['Oi!']);
SELECT pg_temp.resposta(:'P', '73000000-0000-4000-8000-0000000000a1', ARRAY['Tudo certo']);
SELECT pg_temp.ok((SELECT respostas = 2 AND custo_usd = 0.15 FROM public.alice_uso_mensal
                    WHERE conversa_id = '73000000-0000-4000-8000-0000000000a1'), 'mesma conversa: conta uma vez, soma custo');

-- 4 conversas (80% de 5) → aviso de 80%; 5 → aviso de 100%.
SELECT pg_temp.resposta(:'P', ('73000000-0000-4000-8000-0000000000a' || n)::uuid, ARRAY['Oi'])
  FROM generate_series(2, 4) n;
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.mkt_avisos WHERE empresa_id = :'P' AND tipo = 'alice_franquia_80' AND so_no_app),
  'aviso de 80% no sininho, só no app');
SELECT pg_temp.ok((public.alice_pode_responder(:'P', '73000000-0000-4000-8000-0000000000a5')->>'pode')::boolean,
  'quinta conversa ainda cabe');
SELECT pg_temp.resposta(:'P', '73000000-0000-4000-8000-0000000000a5', ARRAY['Oi']);
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.mkt_avisos WHERE empresa_id = :'P' AND tipo = 'alice_franquia_100'),
  'aviso de 100%');

-- Na franquia: conversa nova vai para a equipe; a que já contou segue.
SELECT pg_temp.ok((SELECT r->>'pode' = 'false' AND r->>'motivo' = 'franquia' AND (r->>'usadas')::int = 5
                     FROM (SELECT public.alice_pode_responder(:'P', '73000000-0000-4000-8000-0000000000b1') r) x),
  'conversa nova na franquia vai para a equipe');
SELECT pg_temp.ok((public.alice_pode_responder(:'P', '73000000-0000-4000-8000-0000000000a2')->>'pode')::boolean,
  'conversa que já contou segue');

-- Continuar depois da franquia, teto R$ 7: duas excedentes (R$ 3,50 cada), a terceira para.
UPDATE public.ia_configuracoes SET continuar_apos_franquia = true, teto_excedente_reais = 7 WHERE empresa_id = :'P';
SELECT pg_temp.ok((public.alice_pode_responder(:'P', '73000000-0000-4000-8000-0000000000b2')->>'excedente')::boolean,
  '1ª excedente');
SELECT pg_temp.resposta(:'P', '73000000-0000-4000-8000-0000000000b2', ARRAY['Oi']);
SELECT pg_temp.ok((public.alice_pode_responder(:'P', '73000000-0000-4000-8000-0000000000b3')->>'pode')::boolean, '2ª excedente');
SELECT pg_temp.resposta(:'P', '73000000-0000-4000-8000-0000000000b3', ARRAY['Oi']);
SELECT pg_temp.ok((public.alice_pode_responder(:'P', '73000000-0000-4000-8000-0000000000b4')->>'motivo') = 'teto',
  'teto em R$ atingido');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.mkt_avisos WHERE empresa_id = :'P' AND tipo = 'alice_franquia_teto'),
  'aviso do teto');

-- Conversa acima de R$ 5 (1 dólar × 5,65) vai para a equipe; no plano que não trava, só mede.
SELECT pg_temp.resposta(:'P', '73000000-0000-4000-8000-0000000000a3', ARRAY['Mais'], 1.00);
SELECT pg_temp.ok((public.alice_pode_responder(:'P', '73000000-0000-4000-8000-0000000000a3')->>'motivo') = 'custo',
  'conversa cara vai para a equipe');
SELECT pg_temp.resposta(:'L', '73000000-0000-4000-8000-0000000000c1', ARRAY['Oi'], 2.00);
SELECT pg_temp.resposta(:'L', ('73000000-0000-4000-8000-0000000000c' || n)::uuid, ARRAY['Oi'])
  FROM generate_series(2, 7) n;
SELECT pg_temp.ok((public.alice_pode_responder(:'L', '73000000-0000-4000-8000-0000000000c1')->>'pode')::boolean
                  AND (public.alice_pode_responder(:'L', '73000000-0000-4000-8000-0000000000c9')->>'pode')::boolean,
  'plano que não trava: passa da franquia e do custo, só mede');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.mkt_avisos WHERE empresa_id = :'L' AND tipo LIKE 'alice_franquia%'),
  'plano que não trava não recebe aviso de franquia');

-- Medidor e Painel Nexa.
INSERT INTO auth.users (email) VALUES ('a730@p.test'), ('nexa730@nexa.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'P', 'admin' FROM auth.users WHERE email = 'a730@p.test';
INSERT INTO public.plataforma_usuarios (user_id, papel)
SELECT id, 'nexa_admin' FROM auth.users WHERE email = 'nexa730@nexa.test';
SELECT pg_temp.como('a730@p.test', :'P');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT (u->>'usadas')::int = 7 AND (u->>'franquia')::int = 5 AND (u->>'excedentes')::int = 2
                          AND (u->>'valor_excedente')::numeric = 7.00
                     FROM (SELECT public.alice_uso_do_mes() u) x), 'medidor: 7 de 5, excedente R$ 7');
SELECT pg_temp.ok((SELECT count(*) FROM public.alice_uso_mensal) = 9, 'empresa vê só as próprias conversas');
DO $$ BEGIN
  PERFORM public.alice_pode_responder('73000000-0000-4000-8000-000000000001', gen_random_uuid());
  RAISE EXCEPTION 'FALHOU: usuário chamou a trava do servidor';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM * FROM public.alice_conversas_caras(current_date);
  RAISE EXCEPTION 'FALHOU: empresa viu as conversas caras de todas';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT pg_temp.como('nexa730@nexa.test', NULL);
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT conversa_id = '73000000-0000-4000-8000-0000000000c1' AND custo_reais = 11.30
                     FROM public.alice_conversas_caras(current_date, 1)), 'Nexa vê a conversa mais cara em R$');
SELECT pg_temp.ok((SELECT excedentes = 2 AND valor_excedente = 7.00 AND para_equipe = 3
                     FROM public.alice_franquia_empresas(current_date) WHERE empresa_id = :'P'), 'Painel: excedente e passagens');
RESET ROLE;

ROLLBACK;
