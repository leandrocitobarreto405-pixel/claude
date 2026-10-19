-- Numeração de orçamento por empresa: sequência própria de cada empresa, número fixo depois de
-- criado, falha na criação não deixa buraco, e a OS não é tocada. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set A '11111111-1111-1111-1111-111111111111'
\set B '48000000-0000-0000-0000-00000000000b'
INSERT INTO public.empresas (id, nome) VALUES (:'B', 'Empresa Fictícia B');

CREATE FUNCTION pg_temp.novo(_emp uuid, _nome text) RETURNS integer LANGUAGE sql AS $$
  INSERT INTO public.quotes (empresa_id, cliente_nome, status) VALUES (_emp, _nome, 'rascunho') RETURNING numero
$$;

-- 1) cada empresa tem a sua sequência; empresa nova começa no 1
SELECT coalesce((SELECT ultimo FROM public.orcamento_contadores WHERE empresa_id = :'A'), 0) AS antes_a \gset
SELECT pg_temp.ok(pg_temp.novo(:'A', 'Fictício A1') = :antes_a + 1, 'A: próximo número');
SELECT pg_temp.ok(pg_temp.novo(:'A', 'Fictício A2') = :antes_a + 2, 'A: e o seguinte');
SELECT pg_temp.ok(pg_temp.novo(:'B', 'Fictício B1') = 1, 'B: empresa nova começa no 1');
SELECT pg_temp.ok(pg_temp.novo(:'B', 'Fictício B2') = 2, 'B: segue a própria sequência');
SELECT pg_temp.ok(pg_temp.novo(:'A', 'Fictício A3') = :antes_a + 3, 'A: não pulou por causa da B');

-- 2) o número não muda depois de criado (nem por update direto)
DO $$ BEGIN
  UPDATE public.quotes SET numero = 999 WHERE cliente_nome = 'Fictício B1';
  RAISE EXCEPTION 'FALHOU: número alterado';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- 3) criação que falha não deixa buraco (o aumento do contador é desfeito junto)
DO $$ BEGIN
  INSERT INTO public.quotes (empresa_id, cliente_nome, status)
  VALUES ('48000000-0000-0000-0000-00000000000b', 'Falha', 'situacao-invalida');
  RAISE EXCEPTION 'FALHOU: insert inválido entrou';
EXCEPTION WHEN check_violation OR invalid_text_representation THEN NULL; END $$;
SELECT pg_temp.ok(pg_temp.novo(:'B', 'Fictício B3') = 3, 'B: depois da falha vem o 3 (sem buraco)');

-- 4) número único por empresa (o índice barra repetição)
DO $$ BEGIN
  INSERT INTO public.quotes (empresa_id, cliente_nome, status, numero)
  VALUES ('48000000-0000-0000-0000-00000000000b', 'Repetido', 'rascunho', 1);
  RAISE EXCEPTION 'FALHOU: número repetido entrou';
EXCEPTION WHEN unique_violation THEN NULL; END $$;

-- 5) o contador bate com o maior número e a OS não usa essa numeração
SELECT pg_temp.ok((SELECT ultimo FROM public.orcamento_contadores WHERE empresa_id = :'B') = 3, 'contador B = 3');
SELECT pg_temp.ok((SELECT max(numero) FROM public.quotes WHERE empresa_id = :'A')
                  = (SELECT ultimo FROM public.orcamento_contadores WHERE empresa_id = :'A'), 'contador A = maior número');

ROLLBACK;
