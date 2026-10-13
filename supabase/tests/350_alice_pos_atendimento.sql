-- Depois do agendamento: tudo começa desligado, um envio por OS/tipo/dia, só leitura pela tela.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

INSERT INTO public.ia_configuracoes (empresa_id, ativo) VALUES ('11111111-1111-1111-1111-111111111111', true);
SELECT pg_temp.ok((SELECT NOT confirmacao_ligada AND NOT pos_venda_ligado AND NOT avaliacao_ligada
                     AND confirmacao_hora = '10:00' AND pos_venda_hora = '10:00' AND avaliacao_link IS NULL
                     AND avaliacao_texto LIKE '%{link}%' AND avaliacao_texto LIKE '%{nome}%'
                     FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111'),
  'tudo desligado, 10h e texto da avaliação com {nome} e {link}');
DO $$
BEGIN
  UPDATE public.ia_configuracoes SET avaliacao_link = 'http://inseguro' WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
  RAISE EXCEPTION 'FALHOU: aceitou link sem https';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c3500000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Pessoa Teste', '11900000035');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id)
VALUES ('e3500000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '35001', 'c3500000-0000-0000-0000-000000000001');
INSERT INTO public.ia_pos_atendimento (empresa_id, work_order_id, tipo, data_servico, situacao)
VALUES ('11111111-1111-1111-1111-111111111111', 'e3500000-0000-0000-0000-000000000001', 'confirmacao', '2026-10-14', 'enviado');
DO $$
BEGIN
  INSERT INTO public.ia_pos_atendimento (empresa_id, work_order_id, tipo, data_servico, situacao)
  VALUES ('11111111-1111-1111-1111-111111111111', 'e3500000-0000-0000-0000-000000000001', 'confirmacao', '2026-10-14', 'enviado');
  RAISE EXCEPTION 'FALHOU: duas confirmações para a mesma OS e dia';
EXCEPTION WHEN unique_violation THEN NULL;
END $$;
-- Outro tipo e a avaliação podem conviver.
INSERT INTO public.ia_pos_atendimento (empresa_id, work_order_id, tipo, data_servico, situacao) VALUES
  ('11111111-1111-1111-1111-111111111111', 'e3500000-0000-0000-0000-000000000001', 'pos_venda', '2026-10-14', 'ignorado'),
  ('11111111-1111-1111-1111-111111111111', 'e3500000-0000-0000-0000-000000000001', 'avaliacao', '2026-10-14', 'enviado');
SELECT pg_temp.ok((SELECT count(*) FROM public.ia_pos_atendimento) = 3, 'um por tipo');
DO $$
BEGIN
  UPDATE public.ia_pos_atendimento SET resposta = 'talvez';
  RAISE EXCEPTION 'FALHOU: aceitou resposta desconhecida';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

-- A tela (authenticated) só lê; nada de gravar por fora do servidor.
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.ia_pos_atendimento', 'INSERT'), 'sem INSERT para a tela');
SELECT pg_temp.ok(has_table_privilege('authenticated', 'public.ia_pos_atendimento', 'SELECT'), 'tela lê');

ROLLBACK;
