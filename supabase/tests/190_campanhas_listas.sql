-- Campanhas pelas listas: segmentos sem repetir pessoa, limite de marketing no preparo e na reserva,
-- rascunhos com as listas dos grupos e lembretes do dia esperando aprovação.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.envios(_campanha uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(coalesce(c.nome, 'sem nome') || ':' || e.grupo || ':' || e.template_nome, ' ' ORDER BY l.numero, e.ordem), '')
    FROM public.mkt_envios e JOIN public.mkt_contatos c ON c.id = e.contato_id
    JOIN public.mkt_lotes l ON l.id = e.lote_id
   WHERE e.campanha_id = _campanha
$$;

-- Base: Ana orçamento há 5 dias; Beto orçamento há 200 dias; Caio cliente há 120 dias que pediu
-- orçamento novo há 3 dias; Dani cliente há 400 dias; Eva conversou há 15 dias; Hugo orçamento há
-- 8 dias mas recebeu promoção há 10 dias; Ivo orçamento há 4 dias, sem nome; Juca recusou o N1.
INSERT INTO public.mkt_contatos (empresa_id, nome, primeiro_nome, normalized_phone, tipo, orcamento_em,
  ultimo_servico_em, ultimo_servico_tipo, lead_entrada_em, recusou_grupo, recusou_em) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Ana Souza', 'Ana', '5511920000001', 'nao_comprador', now() - interval '5 days', NULL, NULL, NULL, NULL, NULL),
  ('11111111-1111-1111-1111-111111111111', 'Beto Lima', 'Beto', '5511920000002', 'nao_comprador', now() - interval '200 days', NULL, NULL, NULL, NULL, NULL),
  ('11111111-1111-1111-1111-111111111111', 'Caio Melo', 'Caio', '5511920000003', 'comprador', now() - interval '3 days', now() - interval '120 days', 'higienizacao', NULL, NULL, NULL),
  ('11111111-1111-1111-1111-111111111111', 'Dani Alves', 'Dani', '5511920000004', 'comprador', NULL, now() - interval '400 days', 'higienizacao', NULL, NULL, NULL),
  ('11111111-1111-1111-1111-111111111111', 'Eva Reis', 'Eva', '5511920000005', 'nao_comprador', NULL, NULL, NULL, now() - interval '15 days', NULL, NULL),
  ('11111111-1111-1111-1111-111111111111', 'Hugo Dias', 'Hugo', '5511920000008', 'nao_comprador', now() - interval '8 days', NULL, NULL, NULL, NULL, NULL),
  ('11111111-1111-1111-1111-111111111111', NULL, NULL, '5511920000009', 'nao_comprador', now() - interval '4 days', NULL, NULL, NULL, NULL, NULL),
  ('11111111-1111-1111-1111-111111111111', 'Juca Paz', 'Juca', '5511920000010', 'nao_comprador', now() - interval '6 days', NULL, NULL, NULL, 'N1', now() - interval '10 days');
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, status)
VALUES ('f9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Promo antiga',
        'promocao', date_trunc('month', current_date), 'concluida');
INSERT INTO public.mkt_envios (empresa_id, campanha_id, contato_id, normalized_phone, template_nome, status, enviado_em)
SELECT empresa_id, 'f9000000-0000-0000-0000-000000000001', id, normalized_phone, 'tc_promocao_agenda', 'enviado',
       now() - interval '10 days'
  FROM public.mkt_contatos WHERE nome = 'Hugo Dias';

-- 1. Rascunho sem listas: usa as dos grupos (clientes primeiro). Caio está em clientes e em orçamento:
-- entra uma vez só, no primeiro segmento (C4). Hugo fica fora pelo limite; Juca recusou o N1;
-- Ivo sem nome recebe a versão _sn.
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, grupos, templates, datas_disparo)
VALUES ('f9000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Rascunho', 'calendario',
        date_trunc('month', current_date), '{N1,C4,N3,N2}', '{"C4": "tc_oferta_trimestral", "N1": "tc_orcamento_retomada"}',
        ARRAY[current_date + 30]);
SELECT pg_temp.ok(private.mkt_listas_da_campanha(NULL, '{N1,C4,N3,N2}') -> 0 ->> 'grupo' = 'C4',
  'listas dos grupos: clientes primeiro');
CREATE TEMP TABLE p1 AS SELECT public.mkt_preparar_campanha('f9000000-0000-0000-0000-000000000002') AS r;
SELECT pg_temp.ok(pg_temp.envios('f9000000-0000-0000-0000-000000000002')
  = 'Caio Melo:C4:tc_oferta_trimestral sem nome:N1:tc_orcamento_retomada_sn Ana Souza:N1:tc_orcamento_retomada '
    || 'Beto Lima:N2:' || private.mkt_template_padrao('11111111-1111-1111-1111-111111111111', 'N2', date_trunc('month', current_date)::date),
  'segmentos: ' || pg_temp.envios('f9000000-0000-0000-0000-000000000002'));
SELECT pg_temp.ok((SELECT (r->>'limite_dias')::int = 30 FROM p1), 'estimativa traz o limite');
SELECT pg_temp.ok((SELECT jsonb_array_length(listas) FROM public.mkt_campanhas
                    WHERE id = 'f9000000-0000-0000-0000-000000000002') = 4, 'preparo grava as listas usadas');

-- 2. Lista "conversou" e entre X e Y (clientes saem antes: lista quente primeiro).
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, grupos, datas_disparo, listas)
VALUES ('f9000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Conversa', 'calendario',
        date_trunc('month', current_date), '{}', ARRAY[current_date + 30],
        '[{"grupo": "CV", "familia": "conversa", "ate": 30}, {"grupo": "C5", "familia": "clientes", "de": 365}]');
SELECT public.mkt_preparar_campanha('f9000000-0000-0000-0000-000000000003');
SELECT pg_temp.ok(pg_temp.envios('f9000000-0000-0000-0000-000000000003')
  = 'Dani Alves:C5:' || private.mkt_template_padrao('11111111-1111-1111-1111-111111111111', 'C5', date_trunc('month', current_date)::date)
    || ' Eva Reis:CV:' || private.mkt_modelo('11111111-1111-1111-1111-111111111111', 'conversa'),
  'conversa + clientes há mais de 1 ano: ' || pg_temp.envios('f9000000-0000-0000-0000-000000000003'));

-- 3. Limite editável: com 7 dias, Hugo (promoção há 10 dias) volta a poder receber.
UPDATE public.mkt_configuracoes SET limite_marketing_dias = 7 WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
SELECT public.mkt_preparar_campanha('f9000000-0000-0000-0000-000000000002');
SELECT pg_temp.ok(pg_temp.envios('f9000000-0000-0000-0000-000000000002') LIKE '%Hugo Dias:N1%', 'limite de 7 dias');
UPDATE public.mkt_configuracoes SET limite_marketing_dias = 30 WHERE empresa_id = '11111111-1111-1111-1111-111111111111';

-- 4. Reserva: envio de campanha a quem recebeu promoção depois do preparo é cancelado.
UPDATE public.mkt_configuracoes SET disparo_ligado = true,
       dias_disparo = '{1,2,3,4,5,6,7}' WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
UPDATE public.mkt_campanhas SET status = 'aprovada' WHERE id = 'f9000000-0000-0000-0000-000000000002';
UPDATE public.mkt_lotes SET status = 'aprovado' WHERE campanha_id = 'f9000000-0000-0000-0000-000000000002';
UPDATE public.mkt_envios SET agendado_para = (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '11 hours') AT TIME ZONE 'America/Sao_Paulo'
 WHERE campanha_id = 'f9000000-0000-0000-0000-000000000002';
INSERT INTO public.mkt_envios (empresa_id, campanha_id, contato_id, normalized_phone, template_nome, status, enviado_em)
SELECT empresa_id, 'f9000000-0000-0000-0000-000000000001', id, normalized_phone, 'tc_promocao_agenda', 'enviado',
       now() - interval '2 days'
  FROM public.mkt_contatos WHERE nome = 'Ana Souza';
CREATE TEMP TABLE res AS
  SELECT * FROM public.mkt_reservar_envios(50, ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
                                                + interval '12 hours') AT TIME ZONE 'America/Sao_Paulo'));
SELECT pg_temp.ok((SELECT e.status || ':' || e.erro FROM public.mkt_envios e JOIN public.mkt_contatos c ON c.id = e.contato_id
                    WHERE c.nome = 'Ana Souza' AND e.campanha_id = 'f9000000-0000-0000-0000-000000000002')
  = 'cancelado:limite de marketing: recebeu outra mensagem há menos de 30 dias', 'reserva confere o limite');
SELECT pg_temp.ok((SELECT count(*) FROM res WHERE nome = 'Caio Melo') = 1, 'os outros seguem');

-- 5. Lembretes: C2 com a flag ligada fica esperando aprovação, com aviso; aprovar libera.
INSERT INTO public.mkt_contatos (empresa_id, nome, primeiro_nome, normalized_phone, tipo, ultimo_servico_em,
  ultimo_servico_tipo) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Lia Hig', 'Lia', '5511920000020', 'comprador',
   ((current_date - interval '6 months')::date + time '12:00') AT TIME ZONE 'America/Sao_Paulo', 'higienizacao');
UPDATE public.mkt_configuracoes SET gatilho_c2_ligado = true WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
CREATE TEMP TABLE g AS SELECT public.mkt_gerar_gatilhos('11111111-1111-1111-1111-111111111111') AS r;
SELECT pg_temp.ok((SELECT (r->'C2'->>'novos')::int = 1 AND (r->'C2'->>'aprovacao')::boolean FROM g),
  'C2 gerado para aprovação: ' || (SELECT r::text FROM g));
SELECT pg_temp.ok((SELECT l.status FROM public.mkt_lotes l JOIN public.mkt_envios e ON e.lote_id = l.id
                    WHERE e.gatilho_ref LIKE 'C2:%') = 'aguardando_aprovacao', 'lote segurado');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_avisos WHERE tipo = 'lembretes_aprovacao') = 1, 'aviso para a equipe');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(50, ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
                     + interval '12 hours 30 minutes') AT TIME ZONE 'America/Sao_Paulo')) r WHERE r.grupo = 'C2') = 0,
  'segurado não sai');
SELECT public.mkt_decidir_lembretes((SELECT lote_id FROM public.mkt_envios WHERE gatilho_ref LIKE 'C2:%'), true, NULL);
SELECT pg_temp.ok((SELECT l.status FROM public.mkt_lotes l JOIN public.mkt_envios e ON e.lote_id = l.id
                    WHERE e.gatilho_ref LIKE 'C2:%') = 'aprovado'
               AND (SELECT lido_em IS NOT NULL FROM public.mkt_avisos WHERE tipo = 'lembretes_aprovacao'),
  'aprovado e aviso lido');
DO $$ BEGIN
  PERFORM public.mkt_decidir_lembretes((SELECT lote_id FROM public.mkt_envios WHERE gatilho_ref LIKE 'C2:%'), false, NULL);
  RAISE EXCEPTION 'FALHOU: decidiu duas vezes';
EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF; END $$;

-- 6. Só a chave de serviço decide lembretes; a contagem da campanha é de admin/atendente.
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.mkt_decidir_lembretes(uuid, boolean, uuid)', 'EXECUTE'),
  'decidir lembretes: só servidor');

-- 7. Janela dos lembretes: cliente de higienização há 170 dias (lembrete de 6 meses) fica fora da
-- campanha; há 120 dias, entra. Quem recebeu lembrete nos últimos 30 dias também fica fora.
INSERT INTO public.mkt_contatos (empresa_id, nome, primeiro_nome, normalized_phone, tipo, ultimo_servico_em,
  ultimo_servico_tipo) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Mia Janela', 'Mia', '5511920000030', 'comprador', now() - interval '170 days', 'higienizacao'),
  ('11111111-1111-1111-1111-111111111111', 'Nei Fora', 'Nei', '5511920000031', 'comprador', now() - interval '120 days', 'higienizacao'),
  ('11111111-1111-1111-1111-111111111111', 'Olga Imper', 'Olga', '5511920000032', 'comprador', now() - interval '380 days', 'impermeabilizacao');
SELECT pg_temp.ok(private.mkt_na_janela_lembrete((SELECT id FROM public.mkt_contatos WHERE nome = 'Mia Janela'), current_date)
               AND NOT private.mkt_na_janela_lembrete((SELECT id FROM public.mkt_contatos WHERE nome = 'Nei Fora'), current_date)
               AND private.mkt_na_janela_lembrete((SELECT id FROM public.mkt_contatos WHERE nome = 'Olga Imper'), current_date),
  'janela dos lembretes');
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, grupos, datas_disparo, listas)
VALUES ('f9000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Clientes', 'calendario',
        date_trunc('month', current_date), '{}', ARRAY[current_date + 30],
        '[{"grupo": "C4", "familia": "clientes", "de": 90, "ate": 365}, {"grupo": "C5", "familia": "clientes", "de": 365}]');
SELECT public.mkt_preparar_campanha('f9000000-0000-0000-0000-000000000004');
SELECT pg_temp.ok(pg_temp.envios('f9000000-0000-0000-0000-000000000004') LIKE '%Nei Fora:C4%'
               AND pg_temp.envios('f9000000-0000-0000-0000-000000000004') NOT LIKE '%Mia Janela%'
               AND pg_temp.envios('f9000000-0000-0000-0000-000000000004') NOT LIKE '%Olga Imper%'
               AND pg_temp.envios('f9000000-0000-0000-0000-000000000004') NOT LIKE '%Lia Hig%',
  'campanha sem quem está na janela dos lembretes: ' || pg_temp.envios('f9000000-0000-0000-0000-000000000004'));

-- 8. rotas_distancias: só o servidor lê e grava.
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.rotas_distancias', 'SELECT')
               AND NOT has_table_privilege('anon', 'public.rotas_distancias', 'SELECT'),
  'rotas_distancias fechada para usuários');
ROLLBACK;
