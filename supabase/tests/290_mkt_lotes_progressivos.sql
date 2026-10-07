-- Lotes progressivos: 100, 150, 250 e depois o lote da configuração; mesma ordem; datas da campanha
-- e depois os próximos dias de disparo; posição dentro do lote recomeça em cada dia.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

INSERT INTO public.mkt_configuracoes (empresa_id, lote_tamanho, dias_disparo)
VALUES ('11111111-1111-1111-1111-111111111111', 350, '{2,3,4}')
ON CONFLICT (empresa_id) DO UPDATE SET lote_tamanho = 350, dias_disparo = '{2,3,4}';

-- 620 pessoas com orçamento recente.
INSERT INTO public.mkt_contatos (empresa_id, nome, primeiro_nome, normalized_phone, tipo, orcamento_em)
SELECT '11111111-1111-1111-1111-111111111111', 'Pessoa ' || g, 'Pessoa', '55119500' || lpad(g::text, 5, '0'),
       'nao_comprador', now() - make_interval(days => 1 + g % 20)
  FROM generate_series(1, 620) g;

-- Duas datas escolhidas (terça e quarta daqui a ~2 semanas): 620 → 100, 150, 250, 120.
CREATE TEMP TABLE dias AS
SELECT (current_date + 14 - extract(isodow FROM current_date + 14)::int + 2) AS ter;
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, grupos, datas_disparo, listas, templates)
SELECT 'fc000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Rampa', 'calendario',
       date_trunc('month', current_date), '{}', ARRAY[ter, ter + 1],
       '[{"grupo": "N1", "familia": "orcamento", "ate": 90}]', '{"N1": "tc_orcamento_retomada"}'
  FROM dias;
SELECT public.mkt_preparar_campanha('fc000000-0000-0000-0000-000000000001');
CREATE TEMP TABLE antes AS
SELECT e.contato_id, row_number() OVER (ORDER BY l.numero, e.ordem) AS pos
  FROM public.mkt_envios e JOIN public.mkt_lotes l ON l.id = e.lote_id
 WHERE e.campanha_id = 'fc000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_lotes WHERE campanha_id = 'fc000000-0000-0000-0000-000000000001') = 2,
  'preparo: dois lotes de até 350');

CREATE TEMP TABLE est AS SELECT public.mkt_escalonar_lotes('fc000000-0000-0000-0000-000000000001') AS r;
SELECT pg_temp.ok((SELECT string_agg(quantidade::text, ',' ORDER BY numero) FROM public.mkt_lotes
                    WHERE campanha_id = 'fc000000-0000-0000-0000-000000000001' AND status <> 'cancelado') = '100,150,250,120',
  'tamanhos: ' || (SELECT string_agg(quantidade::text, ',' ORDER BY numero) FROM public.mkt_lotes
                    WHERE campanha_id = 'fc000000-0000-0000-0000-000000000001'));
SELECT pg_temp.ok((SELECT string_agg(n::text, ',' ORDER BY numero) FROM (
                     SELECT l.numero, count(*) n FROM public.mkt_envios e JOIN public.mkt_lotes l ON l.id = e.lote_id
                      WHERE e.campanha_id = 'fc000000-0000-0000-0000-000000000001' GROUP BY l.numero) x) = '100,150,250,120',
  'envios por lote');
SELECT pg_temp.ok((SELECT bool_and(max_ordem = n - 1 AND min_ordem = 0) FROM (
                     SELECT l.numero, count(*) n, min(e.ordem) min_ordem, max(e.ordem) max_ordem
                       FROM public.mkt_envios e JOIN public.mkt_lotes l ON l.id = e.lote_id
                      WHERE e.campanha_id = 'fc000000-0000-0000-0000-000000000001' GROUP BY l.numero) x),
  'posição recomeça em cada lote');
SELECT pg_temp.ok((SELECT bool_and(a.pos = d.pos) FROM antes a JOIN (
                     SELECT e.contato_id, row_number() OVER (ORDER BY l.numero, e.ordem) AS pos
                       FROM public.mkt_envios e JOIN public.mkt_lotes l ON l.id = e.lote_id
                      WHERE e.campanha_id = 'fc000000-0000-0000-0000-000000000001') d ON d.contato_id = a.contato_id),
  'mesma ordem das pessoas');
SELECT pg_temp.ok((SELECT string_agg(to_char(data_prevista, 'ID'), ',' ORDER BY numero) FROM public.mkt_lotes
                    WHERE campanha_id = 'fc000000-0000-0000-0000-000000000001') = '2,3,4,2',
  'dias: as duas datas, depois quinta e a terça seguinte: '
  || (SELECT string_agg(data_prevista::text, ',' ORDER BY numero) FROM public.mkt_lotes
       WHERE campanha_id = 'fc000000-0000-0000-0000-000000000001'));
SELECT pg_temp.ok((SELECT (r ->> 'lotes')::int = 4 AND r -> 'rampa' = '[100,150,250,120]'::jsonb
                          AND r -> 'ordem' -> 0 ->> 'ultimo_lote' = '4' FROM est),
  'estimativa: ' || (SELECT r::text FROM est));
SELECT pg_temp.ok((SELECT array_length(datas_disparo, 1) = 4 FROM public.mkt_campanhas
                    WHERE id = 'fc000000-0000-0000-0000-000000000001'), 'datas da campanha com os 4 dias');

-- Aprovada: o horário de cada envio segue o dia do lote e a posição dentro dele.
SELECT public.mkt_aprovar_campanha('fc000000-0000-0000-0000-000000000001', NULL);
SELECT pg_temp.ok((SELECT count(DISTINCT (e.agendado_para AT TIME ZONE 'America/Sao_Paulo')::date) = 4
                     AND min(e.agendado_para) FILTER (WHERE l.numero = 2) - (l2.data_prevista::timestamp AT TIME ZONE 'America/Sao_Paulo')
                         < interval '1 day'
                     FROM public.mkt_envios e JOIN public.mkt_lotes l ON l.id = e.lote_id
                     CROSS JOIN (SELECT data_prevista FROM public.mkt_lotes
                                  WHERE campanha_id = 'fc000000-0000-0000-0000-000000000001' AND numero = 2) l2
                    WHERE e.campanha_id = 'fc000000-0000-0000-0000-000000000001'
                    GROUP BY l2.data_prevista), 'aprovação agenda cada lote no seu dia');

-- Campanha pequena: só o primeiro dia (e não passa do lote da configuração).
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, grupos, datas_disparo, listas)
SELECT 'fc000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Pequena', 'calendario',
       date_trunc('month', current_date), '{}', ARRAY[ter + 7], '[{"grupo": "C5", "familia": "clientes", "de": 365}]'
  FROM dias;
SELECT public.mkt_preparar_campanha('fc000000-0000-0000-0000-000000000002');
SELECT public.mkt_escalonar_lotes('fc000000-0000-0000-0000-000000000002');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_lotes WHERE campanha_id = 'fc000000-0000-0000-0000-000000000002'
                     AND status <> 'cancelado') <= 1, 'sem pessoas: nada muda');

ROLLBACK;
