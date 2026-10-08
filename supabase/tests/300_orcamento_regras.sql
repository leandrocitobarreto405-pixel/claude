-- Orçamento: categoria preenchida pelos nomes, regras por empresa só para a própria empresa
-- (admin altera, atendente só lê) e campos novos com valor neutro.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

INSERT INTO public.tabela_precos_itens (empresa_id, nome, preco_higienizacao, categoria) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Cadeira de teste', 40, 'cadeira');
SELECT pg_temp.ok((SELECT count(*) FROM public.tabela_precos_itens WHERE categoria NOT IN ('sofa','colchao','cadeira','outro')) = 0,
  'categoria sempre válida');

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'admin@orc.dev'),
  ('00000000-0000-0000-0000-0000000000e2', 'atendente@orc.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('00000000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', 'atendente');

-- Admin cria as regras da empresa.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.orcamento_configuracoes (empresa_id, desconto_adicional_ligado, vitrine_ligada, minimo_cadeiras)
VALUES ('11111111-1111-1111-1111-111111111111', true, true, 90);
RESET ROLE;
SELECT pg_temp.ok((SELECT desconto_adicional_pct = 40 AND pix_pct = 10 AND boas_vindas_pct = 20
                     AND NOT sujidade_ligado AND NOT distancia_ligado AND arredondamento = 'dezena_5'
                     FROM public.orcamento_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111'),
  'padrões das regras');

-- Atendente lê, mas não altera.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.orcamento_configuracoes) = 1, 'atendente lê as regras');
UPDATE public.orcamento_configuracoes SET pix_pct = 25;
RESET ROLE;
SELECT pg_temp.ok((SELECT pix_pct FROM public.orcamento_configuracoes) = 10, 'atendente não altera as regras');

-- Faixas de distância coerentes.
DO $$
BEGIN
  UPDATE public.orcamento_configuracoes SET distancia_sem_acrescimo_km = 30, distancia_limite_km = 10;
  RAISE EXCEPTION 'FALHOU: aceitou faixa invertida';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

-- Orçamento antigo continua igual: campos novos neutros.
INSERT INTO public.quotes (empresa_id, cliente_nome, subtotal, desconto, total)
VALUES ('11111111-1111-1111-1111-111111111111', 'Teste', 100, 0, 100);
SELECT pg_temp.ok((SELECT NOT muito_sujo AND acrescimo_sujidade = 0 AND NOT fora_da_area AND valor_vitrine IS NULL
                     FROM public.quotes WHERE cliente_nome = 'Teste'), 'orçamento sem regras: campos neutros');

ROLLBACK;
