-- Campanha com dia e horário próprios: qualquer dia (até fora dos dias da configuração), hoje se
-- ainda der tempo, aprovação até 10 minutos antes e envio no horário escolhido (8h às 21h).
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
-- Próximo domingo (fora dos dias de disparo da configuração: terça a quinta).
CREATE FUNCTION pg_temp.domingo() RETURNS date LANGUAGE sql AS $$
  SELECT current_date + (7 - extract(isodow FROM current_date))::int + CASE WHEN extract(isodow FROM current_date) = 7 THEN 7 ELSE 0 END
$$;
CREATE FUNCTION pg_temp.as_(_d date, _hora time) RETURNS timestamptz LANGUAGE sql AS $$
  SELECT (_d + _hora)::timestamp AT TIME ZONE 'America/Sao_Paulo'
$$;

INSERT INTO public.mkt_configuracoes (empresa_id, disparo_ligado, dias_disparo, hora_disparo, hora_limite)
VALUES ('11111111-1111-1111-1111-111111111111', true, '{2,3,4}', 10, 19)
ON CONFLICT (empresa_id) DO UPDATE SET disparo_ligado = true, dias_disparo = '{2,3,4}', hora_disparo = 10, hora_limite = 19;
INSERT INTO public.mkt_contatos (empresa_id, nome, primeiro_nome, normalized_phone, tipo, ultimo_servico_em, ultimo_servico_tipo)
VALUES ('11111111-1111-1111-1111-111111111111', 'Ana Lima', 'Ana', '5511950000001', 'comprador', now() - interval '400 days', 'desconhecido');

-- 1. Horário próprio no domingo às 19:30: o domingo vale e o envio fica para 19:30.
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, hora_inicio, datas_disparo, listas)
VALUES ('f9500000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Domingo à noite',
        'calendario', date_trunc('month', pg_temp.domingo()), '19:30', ARRAY[pg_temp.domingo()],
        '[{"grupo": "C5", "familia": "clientes", "de": 365}]');
CREATE TEMP TABLE e1 AS SELECT public.mkt_preparar_campanha('f9500000-0000-0000-0000-000000000001') AS r;
SELECT pg_temp.ok((SELECT data_prevista FROM public.mkt_lotes WHERE campanha_id = 'f9500000-0000-0000-0000-000000000001')
                  = pg_temp.domingo(), 'domingo vale com horário próprio');
SELECT pg_temp.ok((SELECT r->>'hora' FROM e1) = '19:30', 'estimativa traz a hora');
SELECT public.mkt_aprovar_campanha('f9500000-0000-0000-0000-000000000001', NULL);
SELECT pg_temp.ok((SELECT agendado_para FROM public.mkt_envios WHERE campanha_id = 'f9500000-0000-0000-0000-000000000001')
                  = pg_temp.as_(pg_temp.domingo(), '19:30'), 'agendado no horário escolhido');
-- Sem a empresa liberada nada sai; liberada, sai às 19:31 (depois do limite de 19h da configuração).
UPDATE public.empresas SET implantacao_liberada_em = now() WHERE id = '11111111-1111-1111-1111-111111111111';
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, pg_temp.as_(pg_temp.domingo(), '19:20'))) = 0,
  'antes do horário não sai');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, pg_temp.as_(pg_temp.domingo(), '19:31'))) = 1,
  'no horário escolhido sai, mesmo no domingo e depois das 19h');

-- 2. Sem horário próprio, o domingo não vale (vai para o próximo dia de disparo, às 10h).
INSERT INTO public.mkt_contatos (empresa_id, nome, primeiro_nome, normalized_phone, tipo, ultimo_servico_em, ultimo_servico_tipo)
VALUES ('11111111-1111-1111-1111-111111111111', 'Bia Reis', 'Bia', '5511950000002', 'comprador', now() - interval '400 days', 'desconhecido');
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, datas_disparo, listas)
VALUES ('f9500000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Calendário',
        'calendario', date_trunc('month', pg_temp.domingo()), ARRAY[pg_temp.domingo()],
        '[{"grupo": "C5", "familia": "clientes", "de": 365}]');
SELECT public.mkt_preparar_campanha('f9500000-0000-0000-0000-000000000002');
SELECT pg_temp.ok((SELECT extract(isodow FROM data_prevista) FROM public.mkt_lotes
                    WHERE campanha_id = 'f9500000-0000-0000-0000-000000000002') IN (2, 3, 4),
  'sem horário próprio: só os dias da configuração');

-- 3. Hoje: vale se ainda faltam 15 minutos para o horário.
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, hora_inicio, datas_disparo, listas)
VALUES ('f9500000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Hoje',
        'calendario', date_trunc('month', current_date), '20:00', ARRAY[current_date],
        '[{"grupo": "C5", "familia": "clientes", "de": 365}]');
UPDATE public.mkt_envios SET status = 'cancelado' WHERE campanha_id = 'f9500000-0000-0000-0000-000000000002';
SELECT public.mkt_preparar_campanha('f9500000-0000-0000-0000-000000000003');
SELECT pg_temp.ok((SELECT (min(data_prevista) = current_date)
                          = (pg_temp.as_(current_date, '20:00') > now() + interval '15 minutes')
                     FROM public.mkt_lotes WHERE campanha_id = 'f9500000-0000-0000-0000-000000000003'),
  'hoje só se ainda der tempo');

-- 4. Horário fora de 8h–20h não entra.
DO $$ BEGIN
  UPDATE public.mkt_campanhas SET hora_inicio = '21:00' WHERE id = 'f9500000-0000-0000-0000-000000000003';
  RAISE EXCEPTION 'FALHOU: aceitou 21h';
EXCEPTION WHEN check_violation THEN NULL; END $$;
ROLLBACK;
