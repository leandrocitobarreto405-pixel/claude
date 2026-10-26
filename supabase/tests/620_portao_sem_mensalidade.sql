-- Portão sem mensalidade (migração 20261206120000): mensalidade vazia (Nexa Gestão "a definir")
-- ou R$ 0 nunca vira carência, somente leitura nem bloqueio por falta de pagamento; com valor,
-- a regra de atraso vale. Dados fictícios.
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

\set A '62000000-0000-0000-0000-00000000000a'
\set B '62000000-0000-0000-0000-00000000000b'
\set C '62000000-0000-0000-0000-00000000000c'
INSERT INTO public.empresas (id, nome) VALUES
  (:'A', 'Fictícia Gestão'), (:'B', 'Fictícia Zero'), (:'C', 'Fictícia Paga');
-- A: plano sem mensalidade definida, grátis vencido há 10 dias (o Nexa Gestão hoje tem preço;
-- a regra vale para qualquer plano com mensalidade a definir).
INSERT INTO public.planos (codigo, nome, preco_mensal) VALUES ('teste_a_definir', 'A definir (teste)', NULL);
INSERT INTO public.assinaturas (empresa_id, plano_id, status, vigencia_inicio, gratis_ate, proximo_vencimento)
SELECT :'A', id, 'trial', private.hoje_sp() - 100, private.hoje_sp() - 11, private.hoje_sp() - 10
  FROM public.planos WHERE codigo = 'teste_a_definir';
-- B: mensalidade própria de R$ 0.
INSERT INTO public.assinaturas (empresa_id, plano_id, valor_mensal, status, vigencia_inicio)
SELECT :'B', id, 0, 'ativa', private.hoje_sp() - 100 FROM public.planos WHERE codigo = 'completo';
-- C: plano Básico (R$ 50).
INSERT INTO public.assinaturas (empresa_id, plano_id, status, vigencia_inicio)
SELECT :'C', id, 'ativa', private.hoje_sp() - 100 FROM public.planos WHERE codigo = 'basico';

SELECT pg_temp.ok(private.mensalidade_vigente(:'A') IS NULL, 'mensalidade a definir');
SELECT pg_temp.ok(private.mensalidade_vigente(:'B') = 0, 'mensalidade R$ 0');
SELECT pg_temp.ok(private.mensalidade_vigente(:'C') = 50, 'mensalidade do plano');

-- Sem mensalidade: o banco recusa marcar inadimplente.
SELECT pg_temp.deve_falhar($$UPDATE public.assinaturas SET status = 'inadimplente', inadimplente_desde = private.hoje_sp() - 10
  WHERE empresa_id = '62000000-0000-0000-0000-00000000000a'$$, 'inadimplente sem mensalidade');
SELECT pg_temp.deve_falhar($$UPDATE public.assinaturas SET status = 'inadimplente', inadimplente_desde = private.hoje_sp() - 10
  WHERE empresa_id = '62000000-0000-0000-0000-00000000000b'$$, 'inadimplente com R$ 0');
SELECT pg_temp.ok(private.empresa_situacao(:'A') = 'ok' AND private.empresa_situacao(:'B') = 'ok',
  'grátis vencido sem mensalidade continua ok');

-- Mesmo que fique inadimplente por outro caminho (ex.: plano que perdeu o preço), a situação é ok.
UPDATE public.assinaturas SET status = 'inadimplente', inadimplente_desde = private.hoje_sp() - 10
 WHERE empresa_id = :'C';
SELECT pg_temp.ok(private.empresa_situacao(:'C') = 'somente_leitura', 'com mensalidade, o atraso vale');
ALTER TABLE public.assinaturas DISABLE TRIGGER trg_assinaturas_sem_mensalidade;
UPDATE public.assinaturas SET valor_mensal = 0 WHERE empresa_id = :'C';
ALTER TABLE public.assinaturas ENABLE TRIGGER trg_assinaturas_sem_mensalidade;
SELECT pg_temp.ok(private.empresa_situacao(:'C') = 'ok', 'inadimplente com R$ 0 não trava');

-- Cancelar pela Nexa continua bloqueando, com ou sem mensalidade.
UPDATE public.assinaturas SET status = 'cancelada' WHERE empresa_id = :'A';
SELECT pg_temp.ok(private.empresa_situacao(:'A') = 'bloqueada', 'cancelada bloqueia');

-- A trava de somente leitura está em toda tabela com empresa_id (inclusive as que vieram depois).
SELECT pg_temp.ok(private.instalar_travas_somente_leitura() = 0, 'nenhuma tabela sem trava');
ROLLBACK;
