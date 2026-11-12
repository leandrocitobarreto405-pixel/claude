-- Alice e vendas (migração 20261228530000; arquivo 1090). Dados fictícios.
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

\set E '10900000-0000-4000-8000-00000000000e'
\set E2 '10900000-0000-4000-8000-00000000002e'
\set CX '10900000-0000-4000-8000-0000000000c1'
\set CV '10900000-0000-4000-8000-0000000000c2'
\set CV2 '10900000-0000-4000-8000-0000000000c3'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 1090'), (:'E2', 'Outra Fictícia 1090');
INSERT INTO auth.users (email) VALUES ('dona@p1090.test'), ('maria@p1090.test'), ('outra@p1090.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E'::uuid, 'admin'::papel_empresa FROM auth.users WHERE email = 'dona@p1090.test'
UNION ALL SELECT id, :'E'::uuid, 'atendente'::papel_empresa FROM auth.users WHERE email = 'maria@p1090.test'
UNION ALL SELECT id, :'E2'::uuid, 'admin'::papel_empresa FROM auth.users WHERE email = 'outra@p1090.test';
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token) VALUES (:'CX', 'Fictícia 1090', 109001, 'token-1090');
INSERT INTO public.conversas (id, empresa_id, conexao_id, chatwoot_conversation_id) VALUES
  (:'CV', :'E', :'CX', 109001), (:'CV2', :'E2', :'CX', 109002);

-- 1. Chaves novas: tudo nasce desligado, com os parâmetros combinados.
INSERT INTO public.ia_configuracoes (empresa_id, ativo) VALUES (:'E', false);
SELECT pg_temp.ok(
  (SELECT NOT (atalho_apressado OR combo_ligado OR negociacao_ligada OR retorno_alice_cobre
               OR alarme_transferencia OR retomada_manha_alice OR followup5_novo OR fora_area_regra
               OR aviso_fora_do_ar)
     FROM public.ia_configuracoes WHERE empresa_id = :'E'),
  'todas as chaves novas começam desligadas');
SELECT pg_temp.ok(
  (SELECT combo_pct = 10 AND negociacao_teto_pct = 12 AND negociacao_teto_pix_pct = 15
          AND negociacao_espera_min = 10 AND negociacao_volta_min = 4 AND retorno_alice_cobre_min = 15
          AND transferencia_prazo_min = 10 AND followup5_total_pct = 20 AND followup5_piso = 200
          AND fora_area_decisao_km = 50 AND fora_area_pedido_minimo = 1000
     FROM public.ia_configuracoes WHERE empresa_id = :'E'),
  'parâmetros com os valores aprovados');
DO $$ BEGIN
  UPDATE public.ia_configuracoes SET negociacao_teto_pct = 45 WHERE empresa_id = '10900000-0000-4000-8000-00000000000e';
  RAISE EXCEPTION 'FALHOU: teto de 45%% aceito';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- 2. Pedido de autorização.
INSERT INTO public.alice_autorizacoes
  (id, empresa_id, conversa_id, itens, servico, distancia_km, bairro, valor_cheio, valor_pix,
   concorrente_nome, concorrente_valor, frase_cliente, valor_sugerido, desconto_valor, desconto_pct,
   segue_sozinha, prazo_em, voltar_apos)
VALUES
  ('10900000-0000-4000-8000-0000000000a1', :'E', :'CV',
   '[{"item":"Sofá retrátil 3 lugares"},{"item":"Colchão casal"}]'::jsonb, 'higienizacao', 12, 'Bairro Fictício',
   489, 464.55, 'Concorrente Fictício', 435, 'Frase fictícia do cliente.', 435, 54, 11.04,
   true, now() + interval '10 minutes', now() + interval '4 minutes'),
  ('10900000-0000-4000-8000-0000000000a2', :'E2', :'CV2', '[]'::jsonb, NULL, NULL, NULL,
   300, NULL, NULL, NULL, NULL, 264, 36, 12, true, now() + interval '10 minutes', now() + interval '4 minutes');
SELECT pg_temp.ok((SELECT situacao = 'pendente' AND pushes = 0 AND NOT fora_do_horario
                     FROM public.alice_autorizacoes WHERE id = '10900000-0000-4000-8000-0000000000a1'),
  'pedido nasce pendente');
-- Um pendente por conversa.
DO $$ BEGIN
  INSERT INTO public.alice_autorizacoes (empresa_id, conversa_id, valor_cheio, valor_sugerido, desconto_valor, desconto_pct, voltar_apos)
  VALUES ('10900000-0000-4000-8000-00000000000e', '10900000-0000-4000-8000-0000000000c2', 489, 440, 49, 10, now());
  RAISE EXCEPTION 'FALHOU: dois pedidos pendentes na mesma conversa';
EXCEPTION WHEN unique_violation THEN NULL; END $$;
-- Autorizado sem valor final, segue sozinha sem prazo, sugerido acima do cheio: recusados.
DO $$ BEGIN
  UPDATE public.alice_autorizacoes SET situacao = 'autorizado' WHERE id = '10900000-0000-4000-8000-0000000000a1';
  RAISE EXCEPTION 'FALHOU: autorizado sem valor final';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  UPDATE public.alice_autorizacoes SET prazo_em = NULL WHERE id = '10900000-0000-4000-8000-0000000000a1';
  RAISE EXCEPTION 'FALHOU: segue sozinha sem prazo';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  UPDATE public.alice_autorizacoes SET valor_sugerido = 600 WHERE id = '10900000-0000-4000-8000-0000000000a1';
  RAISE EXCEPTION 'FALHOU: sugerido acima do valor cheio';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  UPDATE public.alice_autorizacoes SET situacao = 'talvez' WHERE id = '10900000-0000-4000-8000-0000000000a1';
  RAISE EXCEPTION 'FALHOU: situação desconhecida aceita';
EXCEPTION WHEN check_violation THEN NULL; END $$;
-- Com cupom: nunca segue sozinha, e não precisa de prazo.
INSERT INTO public.alice_autorizacoes (empresa_id, valor_cheio, desconto_atual_tipo, desconto_atual_valor, cupom,
                                       valor_sugerido, desconto_valor, desconto_pct, segue_sozinha, voltar_apos)
VALUES (:'E', 600, 'cupom', 50, 'CUPOMFICTICIO', 528, 72, 12, false, now());
-- Depois de respondido, cabe outro pedido pendente na mesma conversa.
UPDATE public.alice_autorizacoes SET situacao = 'outro_valor', valor_final = 450, respondido_em = now()
 WHERE id = '10900000-0000-4000-8000-0000000000a1';
INSERT INTO public.alice_autorizacoes (empresa_id, conversa_id, valor_cheio, valor_sugerido, desconto_valor, desconto_pct, voltar_apos)
VALUES (:'E', :'CV', 489, 440, 49, 10, now());

-- 3. Transferência com alarme: uma em aberto por conversa.
INSERT INTO public.alice_transferencias (id, empresa_id, conversa_id, motivo, resumo, prazo_em)
VALUES ('10900000-0000-4000-8000-0000000000b1', :'E', :'CV', 'encaixe', 'Resumo fictício.', now() + interval '10 minutes'),
       ('10900000-0000-4000-8000-0000000000b2', :'E2', :'CV2', 'item fora da tabela', NULL, NULL);
DO $$ BEGIN
  INSERT INTO public.alice_transferencias (empresa_id, conversa_id, motivo)
  VALUES ('10900000-0000-4000-8000-00000000000e', '10900000-0000-4000-8000-0000000000c2', 'outra');
  RAISE EXCEPTION 'FALHOU: duas transferências em aberto na mesma conversa';
EXCEPTION WHEN unique_violation THEN NULL; END $$;
UPDATE public.alice_transferencias SET respondida_em = now() WHERE id = '10900000-0000-4000-8000-0000000000b1';
INSERT INTO public.alice_transferencias (empresa_id, conversa_id, motivo) VALUES (:'E', :'CV', 'desconto acima da margem');
DO $$ BEGIN
  INSERT INTO public.alice_transferencias (empresa_id, conversa_id, motivo)
  VALUES ('10900000-0000-4000-8000-00000000000e', '10900000-0000-4000-8000-0000000000c2', '');
  RAISE EXCEPTION 'FALHOU: transferência sem motivo';
EXCEPTION WHEN check_violation OR unique_violation THEN NULL; END $$;

-- 4. Medição.
INSERT INTO public.alice_eventos (empresa_id, tipo, conversa_id, dados) VALUES
  (:'E', 'atalho_apressado', :'CV', '{"segundos_ate_orcamento": 95}'::jsonb),
  (:'E2', 'combo_orcado', :'CV2', '{}'::jsonb);
DO $$ BEGIN
  INSERT INTO public.alice_eventos (empresa_id, tipo) VALUES ('10900000-0000-4000-8000-00000000000e', 'Tipo Com Espaço');
  RAISE EXCEPTION 'FALHOU: tipo fora do padrão aceito';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- 5 e 6. Tipos novos de push e de desconto; os antigos continuam valendo.
INSERT INTO public.push_envios (empresa_id, user_id, tipo, ref, titulo)
SELECT :'E'::uuid, u.id, t, 'ref-1090-' || t, 'Título fictício'
  FROM auth.users u, unnest(ARRAY['autorizacao_desconto', 'transferencia_alice', 'retorno_combinado',
                                  'alice_fora_do_ar', 'cliente_esperando', 'tatiana_tarefas']) t
 WHERE u.email = 'dona@p1090.test';
DO $$ BEGIN
  INSERT INTO public.push_envios (empresa_id, user_id, tipo, ref, titulo)
  SELECT '10900000-0000-4000-8000-00000000000e', id, 'tipo_inventado', 'r', 't' FROM auth.users WHERE email = 'dona@p1090.test';
  RAISE EXCEPTION 'FALHOU: tipo de push inventado aceito';
EXCEPTION WHEN check_violation THEN NULL; END $$;
INSERT INTO public.quotes (empresa_id, cliente_nome, total, desconto_tipo, desconto_pct) VALUES
  (:'E', 'Cliente Fictício Combo', 900, 'combo', 10),
  (:'E', 'Cliente Fictício Negociação', 435, 'negociacao', 11.04),
  (:'E', 'Cliente Fictício Campanha', 300, 'campanha', 10);
DO $$ BEGIN
  INSERT INTO public.quotes (empresa_id, cliente_nome, total, desconto_tipo)
  VALUES ('10900000-0000-4000-8000-00000000000e', 'Cliente Fictício', 100, 'inventado');
  RAISE EXCEPTION 'FALHOU: tipo de desconto inventado aceito';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- Quem lê o quê. Admin: pedidos, transferências e medição da empresa dele; ninguém grava direto.
SELECT pg_temp.como('dona@p1090.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.alice_autorizacoes) = 3, 'admin vê os 3 pedidos da empresa');
SELECT pg_temp.ok((SELECT count(*) FROM public.alice_transferencias) = 2, 'admin vê as 2 transferências da empresa');
SELECT pg_temp.ok((SELECT count(*) FROM public.alice_eventos) = 1, 'admin vê a medição da empresa');
DO $$ BEGIN
  UPDATE public.alice_autorizacoes SET situacao = 'negado';
  IF FOUND THEN RAISE EXCEPTION 'FALHOU: admin alterou o pedido direto'; END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  INSERT INTO public.alice_autorizacoes (empresa_id, valor_cheio, valor_sugerido, desconto_valor, desconto_pct, voltar_apos)
  VALUES ('10900000-0000-4000-8000-00000000000e', 100, 90, 10, 10, now());
  RAISE EXCEPTION 'FALHOU: admin criou pedido direto';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  DELETE FROM public.alice_transferencias;
  IF FOUND THEN RAISE EXCEPTION 'FALHOU: admin apagou transferência'; END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  INSERT INTO public.alice_eventos (empresa_id, tipo) VALUES ('10900000-0000-4000-8000-00000000000e', 'teste');
  RAISE EXCEPTION 'FALHOU: admin gravou medição direto';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

-- Atendente: vê pedidos e transferências (ela autoriza pelo app), não vê a medição.
SELECT pg_temp.como('maria@p1090.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.alice_autorizacoes) = 3, 'atendente vê os pedidos');
SELECT pg_temp.ok((SELECT count(*) FROM public.alice_transferencias) = 2, 'atendente vê as transferências');
SELECT pg_temp.ok((SELECT count(*) FROM public.alice_eventos) = 0, 'atendente não vê a medição');
RESET ROLE;

-- Outra empresa: só o que é dela.
SELECT pg_temp.como('outra@p1090.test', :'E2');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.alice_autorizacoes) = 1, 'outra empresa vê só o pedido dela');
SELECT pg_temp.ok((SELECT count(*) FROM public.alice_transferencias) = 1, 'outra empresa vê só a transferência dela');
SELECT pg_temp.ok((SELECT count(*) FROM public.alice_eventos) = 1, 'outra empresa vê só a medição dela');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.alice_autorizacoes WHERE empresa_id = :'E'), 'não vaza pedido de outra empresa');
RESET ROLE;

ROLLBACK;
