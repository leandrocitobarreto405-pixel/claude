-- Ações da Tatiana (migração 20261228440000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

\set E '99000000-0000-4000-8000-00000000001d'
\set E2 '99000000-0000-4000-8000-00000000002d'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 1030'), (:'E2', 'Outra Fictícia 1030');
INSERT INTO public.comercial_acoes (id, empresa_id, tipo, situacao, titulo, frase, referencia, antes, depois)
  VALUES ('99000000-0000-4000-8000-00000000003d', :'E', 'previsao_pagamento', 'feita', 'Previsão de pagamento R$ 240 em 5x no cartão', 'fecha em 5x no cartão', '{"work_order_id": "99000000-0000-4000-8000-00000000004d"}', '{"negotiated_payment_method": null}', '{"negotiated_payment_method": "Crédito 5x"}');
INSERT INTO public.comercial_acoes (empresa_id, tipo, situacao, titulo) VALUES (:'E2', 'cadastro', 'faria', 'Cadastro: e-mail');
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_acoes WHERE empresa_id = :'E') = 1, 'ação gravada');

-- Tipo e situação fora da lista não entram.
DO $$ BEGIN
  INSERT INTO public.comercial_acoes (empresa_id, tipo, titulo) VALUES ('99000000-0000-4000-8000-00000000001d', 'apagar_tudo', 'x');
  RAISE EXCEPTION 'FALHOU: tipo inválido entrou';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO public.comercial_acoes (empresa_id, tipo, situacao, titulo) VALUES ('99000000-0000-4000-8000-00000000001d', 'cadastro', 'feita_depois', 'x');
  RAISE EXCEPTION 'FALHOU: situação inválida entrou';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- Quem é da empresa lê só as da empresa; não grava.
INSERT INTO auth.users (id, email) VALUES ('99000000-0000-4000-8000-00000000005d', 'equipe1030@ficticio.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES ('99000000-0000-4000-8000-00000000005d', :'E', 'admin');
SELECT set_config('request.jwt.claims', '{"sub":"99000000-0000-4000-8000-00000000005d","role":"authenticated"}', true);
SELECT set_config('app.empresa_ativa', :'E', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_acoes) = 1, 'equipe lê só as ações da empresa');
DO $$ BEGIN
  UPDATE public.comercial_acoes SET situacao = 'desfeita' WHERE id = '99000000-0000-4000-8000-00000000003d';
  IF FOUND THEN RAISE EXCEPTION 'FALHOU: authenticated gravou ação'; END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
ROLLBACK;
