-- Nome certo nos toques (migração 20261228400000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

SELECT pg_temp.ok(private.mkt_primeiro_nome('Cond. Residencial Jardins') IS NULL, 'Cond não é nome');
SELECT pg_temp.ok(private.mkt_primeiro_nome('Condomínio Solar') IS NULL, 'Condomínio não é nome');
SELECT pg_temp.ok(private.mkt_primeiro_nome('Clínica Vida') IS NULL, 'Clínica não é nome');
SELECT pg_temp.ok(private.mkt_primeiro_nome('Sr. José') IS NULL, 'Sr não é nome');
SELECT pg_temp.ok(private.mkt_primeiro_nome('Jhn') IS NULL, 'sem vogal não é nome');
SELECT pg_temp.ok(private.mkt_primeiro_nome('maria clara') = 'Maria', 'Maria continua');
SELECT pg_temp.ok(private.mkt_primeiro_nome('José da Silva') = 'José', 'José continua');
SELECT pg_temp.ok(private.mkt_primeiro_nome('Ana') = 'Ana', 'nome curto com vogal continua');

-- O gatilho recalcula o primeiro nome ao gravar o contato.
\set E '99000000-0000-4000-8000-00000000000e'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 990');
INSERT INTO public.mkt_contatos (empresa_id, nome, normalized_phone, tipo)
VALUES (:'E', 'Cond. Fictício Bloco B', '5511999000001', 'nao_comprador'),
       (:'E', 'Beatriz Fictícia', '5511999000002', 'nao_comprador');
SELECT pg_temp.ok((SELECT primeiro_nome FROM public.mkt_contatos WHERE normalized_phone = '5511999000001') IS NULL, 'contato de condomínio fica sem nome (modelo _sn)');
SELECT pg_temp.ok((SELECT primeiro_nome FROM public.mkt_contatos WHERE normalized_phone = '5511999000002') = 'Beatriz', 'pessoa mantém o primeiro nome');
ROLLBACK;
