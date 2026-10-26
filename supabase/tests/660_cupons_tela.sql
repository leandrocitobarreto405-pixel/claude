-- Cupons com tela própria (migração 20261210120000): valor OU percentual, validade, origem da
-- mesma empresa, código em maiúsculas, e os cupons da Turbine com a origem pelo canal. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.deve_falhar(_sql text, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU (deveria ter sido bloqueado): %', _msg;
END $$;
\set E '11111111-1111-1111-1111-111111111111'
\set M '99999999-9999-4999-8999-999999999999'

-- Cupons existentes: continuam em reais e ganharam a origem pelo canal.
SELECT pg_temp.ok((SELECT bool_and(valor IS NOT NULL AND percentual IS NULL) FROM public.cupons WHERE empresa_id = :'E'),
  'cupons atuais continuam em reais');
SELECT pg_temp.ok((SELECT o.metadata->>'codigo' FROM public.cupons c JOIN public.config_options o ON o.id = c.origem_id
                    WHERE c.empresa_id = :'E' AND c.codigo = 'BLOG50') = 'blog', 'BLOG50 → origem Blog');
SELECT pg_temp.ok((SELECT o.metadata->>'codigo' FROM public.cupons c JOIN public.config_options o ON o.id = c.origem_id
                    WHERE c.empresa_id = :'E' AND c.codigo = 'SITE82') = 'site', 'SITE82 → origem Site');

-- Percentual com validade; código digitado em minúsculas vira maiúsculas.
INSERT INTO public.cupons (empresa_id, codigo, percentual, servico, valido_ate)
VALUES (:'E', ' dez10 ', 10, 'higienizacao', '2026-12-31');
SELECT pg_temp.ok((SELECT percentual = 10 AND valor IS NULL AND valido_ate = '2026-12-31'
                     FROM public.cupons WHERE empresa_id = :'E' AND codigo = 'DEZ10'), 'cupom de 10% até 31/12');

SELECT pg_temp.deve_falhar($$INSERT INTO public.cupons (empresa_id, codigo, valor, percentual, servico)
  VALUES ('11111111-1111-1111-1111-111111111111', 'AMBOS1', 10, 10, 'higienizacao')$$, 'valor e percentual juntos');
SELECT pg_temp.deve_falhar($$INSERT INTO public.cupons (empresa_id, codigo, servico)
  VALUES ('11111111-1111-1111-1111-111111111111', 'NENHUM1', 'higienizacao')$$, 'sem valor nem percentual');
SELECT pg_temp.deve_falhar($$INSERT INTO public.cupons (empresa_id, codigo, percentual, servico)
  VALUES ('11111111-1111-1111-1111-111111111111', 'CEM101', 101, 'higienizacao')$$, 'percentual acima de 100');
SELECT pg_temp.deve_falhar(format($$INSERT INTO public.cupons (empresa_id, codigo, valor, servico, origem_id)
  VALUES ('11111111-1111-1111-1111-111111111111', 'OUTRA1', 10, 'higienizacao', %L)$$,
  (SELECT id FROM public.config_options WHERE empresa_id = :'M' AND kind = 'sales_origin' LIMIT 1)),
  'origem de outra empresa');
SELECT pg_temp.deve_falhar(format($$INSERT INTO public.cupons (empresa_id, codigo, valor, servico, origem_id)
  VALUES ('11111111-1111-1111-1111-111111111111', 'TIPO1', 10, 'higienizacao', %L)$$,
  (SELECT id FROM public.config_options WHERE empresa_id = :'E' AND kind = 'payment_method' LIMIT 1)),
  'origem que não é origem de lead');
ROLLBACK;
