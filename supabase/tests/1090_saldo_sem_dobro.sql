-- Saldo sem dobro (migração 20261228540000; arquivo 1090). Um dia inteiro com toda chamada de IA
-- gravada em ia_chamadas e parte delas também nas tabelas antigas: o consumido do saldo tem de ser
-- igual à soma real das chamadas do dia, sem dobrar e sem faltar nada. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

\set A '10800000-0000-4000-8000-00000000000a'
\set T1 '10800000-0000-4000-8000-0000000000a1'
\set R1 '10800000-0000-4000-8000-0000000000e1'
\set K1 '10800000-0000-4000-8000-0000000000c1'
INSERT INTO public.empresas (id, nome) VALUES (:'A', 'Empresa Fictícia 1090');
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, grupos, templates, datas_disparo, status)
VALUES (:'K1', :'A', 'Campanha fictícia', 'calendario', '2030-05-01', '{C4}', '{"C4": "tc_oferta_trimestral"}', '{2030-05-10}', 'concluida');

-- Dia 10/05/2030 em São Paulo (03:00 UTC até 03:00 UTC do dia seguinte).
-- Tabelas antigas (o que já era somado antes):
INSERT INTO public.ia_execucoes (empresa_id, modelo, custo_usd, mensagens_enviadas, created_at) VALUES
  (:'A', 'm', 0.200000, ARRAY['oi'], '2030-05-10 12:00:30+00');    -- tarefa T1 (as 2 chamadas abaixo)
INSERT INTO public.comercial_noites (empresa_id, noite, modo, custo_usd, iniciada_em) VALUES
  (:'A', '2030-05-10', 'ativo', 1.700000, '2030-05-11 00:30:00+00');    -- 1,10 rodadas + 0,60 lote
INSERT INTO public.comercial_relatorios (id, empresa_id, periodo, dados, custo_usd, criado_em) VALUES
  (:'R1', :'A', 'Semana fictícia', '{}', 0.300000, '2030-05-10 13:00:00+00'),
  ('10800000-0000-4000-8000-0000000000e2', :'A', 'Base parada · 10/05', '{"tipo":"base_parada"}', 0.250000, '2030-05-10 13:10:00+00'),
  ('10800000-0000-4000-8000-0000000000e3', :'A', 'Não soube fictício', '{"tipo":"nao_soube"}', 0.200000, '2030-05-10 13:20:00+00');
INSERT INTO public.comercial_planos (empresa_id, dia, custo_usd, criado_em) VALUES
  (:'A', '2030-05-10', 0.050000, '2030-05-10 10:00:00+00');
INSERT INTO public.comercial_campanhas (empresa_id, campanha_id, janela_inicio, janela_fim, custo_usd, criado_em) VALUES
  (:'A', :'K1', '2030-05-10 13:00+00', '2030-05-17 13:00+00', 0.070000, '2030-05-10 14:00:00+00');

-- Toda chamada do dia em ia_chamadas (a soma real).
INSERT INTO public.ia_chamadas (empresa_id, origem, modelo, custo_usd, ok, referencia, criado_em) VALUES
  -- já somadas em outra tabela
  (:'A', 'alice_conversa',         'm', 0.120000, true,  :'T1', '2030-05-10 12:00:10+00'),
  (:'A', 'alice_conversa',         'm', 0.080000, true,  :'T1', '2030-05-10 12:00:20+00'),
  (:'A', 'tatiana_noite',          'm', 0.500000, true,  NULL,  '2030-05-11 00:31:00+00'),
  (:'A', 'tatiana_noite',          'm', 0.400000, true,  NULL,  '2030-05-11 00:32:00+00'),
  (:'A', 'tatiana_mensagem',       'm', 0.150000, true,  NULL,  '2030-05-11 00:33:00+00'),
  (:'A', 'tatiana_recado',         'm', 0.050000, true,  NULL,  '2030-05-11 00:40:00+00'),
  (:'A', 'lote',                   'm', 0.600000, true,  NULL,  '2030-05-11 01:00:00+00'),
  (:'A', 'relatorio',              'm', 0.300000, true,  NULL,  '2030-05-10 12:59:00+00'),
  (:'A', 'base_parada',            'm', 0.250000, true,  NULL,  '2030-05-10 13:09:00+00'),
  (:'A', 'alice_nao_soube',        'm', 0.200000, true,  NULL,  '2030-05-10 13:19:00+00'),
  (:'A', 'plano',                  'm', 0.050000, true,  NULL,  '2030-05-10 09:59:00+00'),
  (:'A', 'campanha',               'm', 0.040000, true,  NULL,  '2030-05-10 13:59:00+00'),
  (:'A', 'classificador_campanha', 'm', 0.030000, true,  NULL,  '2030-05-10 13:58:00+00'),
  -- só existem em ia_chamadas
  (:'A', 'toque_equipe',           'm', 0.010000, true,  NULL,  '2030-05-10 13:00:00+00'),
  (:'A', 'classificador_toque',    'm', 0.002000, true,  NULL,  '2030-05-10 11:00:00+00'),
  (:'A', 'classificador_site',     'm', 0.001000, true,  NULL,  '2030-05-10 11:30:00+00'),
  (:'A', 'retorno_combinado',      'm', 0.003000, true,  NULL,  '2030-05-10 11:40:00+00'),
  (:'A', 'tatiana_analise',        'm', 0.090000, true,  NULL,  '2030-05-10 15:00:00+00'),
  (:'A', 'ensaio',                 'm', 0.190000, true,  NULL,  '2030-05-10 16:00:00+00'),
  (:'A', 'alice_conversa',         'desconhecido', 0, false, NULL, '2030-05-10 17:00:00+00'),
  -- fora do dia (não entra)
  (:'A', 'classificador_toque',    'm', 5.000000, true,  NULL,  '2030-05-11 03:00:00+00');

DELETE FROM public.configuracoes_plataforma WHERE chave IN ('ia_credito_carregado_usd', 'ia_credito_carregado_em');
INSERT INTO public.configuracoes_plataforma (chave, valor) VALUES
  ('ia_credito_carregado_usd', '50'::jsonb), ('ia_credito_carregado_em', '"2030-05-10"'::jsonb);

CREATE TEMP TABLE dia AS SELECT
  (SELECT sum(custo_usd) FROM public.ia_chamadas
    WHERE criado_em >= '2030-05-10 03:00:00+00' AND criado_em < '2030-05-11 03:00:00+00') AS real,
  (SELECT coalesce(sum(custo_usd), 0) FROM public.ia_execucoes
    WHERE created_at >= '2030-05-10 03:00:00+00' AND created_at < '2030-05-11 03:00:00+00')
  + private.tatiana_custo_usd(NULL, '2030-05-10 03:00:00+00', '2030-05-11 03:00:00+00')
  + private.ia_chamadas_custo_usd(NULL, '2030-05-10 03:00:00+00', '2030-05-11 03:00:00+00') AS saldo;

SELECT pg_temp.ok((SELECT real FROM dia) = 3.066, 'soma real das chamadas do dia: 3,066');
SELECT pg_temp.ok((SELECT saldo = real FROM dia),
  format('saldo do dia = soma real, sem dobrar e sem faltar (saldo %s, real %s)',
         (SELECT saldo FROM dia), (SELECT real FROM dia)));
SELECT pg_temp.ok(private.ia_chamadas_custo_usd(NULL, '2030-05-10 03:00:00+00', '2030-05-11 03:00:00+00') = 0.296,
  'só o que não está em outra tabela: toque da equipe, classificadores, retorno, análise e ensaio');
-- Lote da noite: o custo fica só em comercial_noites (0,60 dentro da noite acima) e em
-- ia_chamadas com a origem "lote". Ele conta uma vez só no saldo.
SELECT pg_temp.ok(private.tatiana_custo_usd(NULL, '2030-05-10 03:00:00+00', '2030-05-11 03:00:00+00') = 2.570,
  'Tatiana do dia: noite 1,70 (com o lote) + relatórios 0,75 + plano 0,05 + campanha 0,07');
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_lotes WHERE empresa_id = :'A') = 0,
  'o lote da noite não grava em comercial_lotes');
-- Se o lote da noite também fosse gravado em comercial_lotes, o saldo passaria da soma real.
SAVEPOINT lote_em_dobro;
INSERT INTO public.comercial_lotes (empresa_id, leads, custo_usd, pedido_em) VALUES
  (:'A', '{10800000-0000-4000-8000-0000000000f1}', 0.600000, '2030-05-11 01:00:00+00');
SELECT pg_temp.ok(
  (SELECT coalesce(sum(custo_usd), 0) FROM public.ia_execucoes
    WHERE created_at >= '2030-05-10 03:00:00+00' AND created_at < '2030-05-11 03:00:00+00')
  + private.tatiana_custo_usd(NULL, '2030-05-10 03:00:00+00', '2030-05-11 03:00:00+00')
  + private.ia_chamadas_custo_usd(NULL, '2030-05-10 03:00:00+00', '2030-05-11 03:00:00+00')
  = (SELECT real FROM dia) + 0.60,
  'lote gravado nas duas tabelas contaria em dobro (o teste pega)');
ROLLBACK TO SAVEPOINT lote_em_dobro;

SELECT pg_temp.ok((public.ia_saldo_estimado()->>'consumido_usd')::numeric = round(3.066 + 5, 2),
  'consumido do saldo desde a carga (inclui a chamada do dia seguinte)');
SELECT pg_temp.ok((public.ia_saldo_estimado()->>'restante_usd')::numeric = round(50 - 8.066, 2),
  'restante do saldo');

ROLLBACK;
