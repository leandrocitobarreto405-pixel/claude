-- WhatsApp Cloud pelo app Nexa OS (migração 20261228470000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

\set A '10100000-0000-4000-8000-00000000000a'
\set B '10100000-0000-4000-8000-00000000000b'
INSERT INTO public.empresas (id, nome) VALUES (:'A', 'Empresa Fictícia A 1010'), (:'B', 'Empresa Fictícia B 1010');
INSERT INTO auth.users (id, email) VALUES
  ('10100000-0000-4000-8000-0000000000a1', 'admin-a-1010@teste.dev'),
  ('10100000-0000-4000-8000-0000000000a2', 'atendente-a-1010@teste.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES
  ('10100000-0000-4000-8000-0000000000a1', :'A', 'admin'),
  ('10100000-0000-4000-8000-0000000000a2', :'A', 'atendente');

-- Servidor grava: conexão das duas empresas, segredo e eventos.
INSERT INTO public.whatsapp_cloud_conexoes (empresa_id, situacao, waba_id, phone_number_id)
VALUES (:'A', 'conectado', '1010000001', '1010000011'), (:'B', 'conectado', '1010000002', '1010000022');
INSERT INTO public.whatsapp_cloud_segredos (empresa_id, token_cifrado)
VALUES (:'A', 'v1.cifrado-ficticio-com-mais-de-vinte');
INSERT INTO public.whatsapp_cloud_eventos (empresa_id, tipo, phone_number_id, payload)
VALUES (:'A', 'mensagem', '1010000011', '{}'), (:'B', 'mensagem', '1010000022', '{}'), (NULL, 'mensagem', '1547429628435173', '{}');

-- O mesmo número não pode estar em duas empresas.
DO $$
BEGIN
  UPDATE public.whatsapp_cloud_conexoes SET phone_number_id = '1010000011'
   WHERE empresa_id = '10100000-0000-4000-8000-00000000000b';
  RAISE EXCEPTION 'FALHOU: número repetido aceito';
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- Admin da empresa A: vê só a conexão e os eventos da A; nunca o segredo.
SELECT set_config('request.jwt.claims', '{"sub":"10100000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SELECT set_config('request.headers', '{"x-empresa-id":"10100000-0000-4000-8000-00000000000a"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_cloud_conexoes) = 1, 'admin vê só a conexão da própria empresa');
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_cloud_eventos) = 1, 'admin vê só os eventos da própria empresa');
DO $$
BEGIN
  PERFORM 1 FROM public.whatsapp_cloud_segredos;
  RAISE EXCEPTION 'FALHOU: admin leu o segredo';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$
BEGIN
  UPDATE public.whatsapp_cloud_conexoes SET situacao = 'erro';
  IF FOUND THEN RAISE EXCEPTION 'FALHOU: tela gravou a conexão'; END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM 1 FROM public.meta_exclusao_pedidos;
  RAISE EXCEPTION 'FALHOU: tela leu pedidos de exclusão';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

-- Atendente da empresa A: não vê a conexão (só admin).
SELECT set_config('request.jwt.claims', '{"sub":"10100000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_cloud_conexoes) = 0, 'atendente não vê a conexão');
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_cloud_eventos) = 0, 'atendente não vê eventos');
RESET ROLE;

-- Guarda de 90 dias: só o evento mais velho sai.
INSERT INTO public.whatsapp_cloud_eventos (tipo, payload, recebido_em)
VALUES ('outro', '{"t":"velho"}', now() - interval '91 days'), ('outro', '{"t":"novo"}', now() - interval '89 days');
SELECT pg_temp.ok(private.whatsapp_cloud_limpar_eventos() = 1, 'limpeza apaga só o evento com mais de 90 dias');
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_cloud_eventos WHERE payload->>'t' = 'novo') = 1, 'evento de 89 dias fica');

-- Desautorizar marca a conexão (sem apagar).
UPDATE public.whatsapp_cloud_conexoes SET meta_user_id = '1010999' WHERE empresa_id = :'A';
UPDATE public.whatsapp_cloud_conexoes SET situacao = 'desautorizado', desautorizado_em = now() WHERE meta_user_id = '1010999';
SELECT pg_temp.ok((SELECT situacao FROM public.whatsapp_cloud_conexoes WHERE empresa_id = :'A') = 'desautorizado', 'situação desautorizado aceita');
SELECT pg_temp.ok((SELECT count(*) FROM public.whatsapp_cloud_segredos WHERE empresa_id = :'A') = 1, 'segredo continua (nada apagado)');
ROLLBACK;
