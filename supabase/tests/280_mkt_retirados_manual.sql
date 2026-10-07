-- Marketing: pessoas presas em outra campanha, "já chamei manualmente" (regra dos 30 dias nas
-- campanhas e nos lembretes) e marcação por planilha só pelo admin.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.envios(_campanha uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(c.nome, ',' ORDER BY c.nome), '-')
    FROM public.mkt_envios e JOIN public.mkt_contatos c ON c.id = e.contato_id
   WHERE e.campanha_id = _campanha AND e.status = 'pendente'
$$;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'admin@retirados.dev'),
  ('00000000-0000-0000-0000-0000000000d2', 'atendente@retirados.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('00000000-0000-0000-0000-0000000000d2', '11111111-1111-1111-1111-111111111111', 'atendente');

INSERT INTO public.mkt_contatos (empresa_id, nome, primeiro_nome, normalized_phone, tipo, orcamento_em,
  ultimo_servico_em, ultimo_servico_tipo) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Ana Prado', 'Ana', '5511930000001', 'nao_comprador', now() - interval '5 days', NULL, NULL),
  ('11111111-1111-1111-1111-111111111111', 'Bia Prado', 'Bia', '5511930000002', 'nao_comprador', now() - interval '6 days', NULL, NULL),
  ('11111111-1111-1111-1111-111111111111', 'Caio Prado', 'Caio', '5511930000003', 'nao_comprador', now() - interval '7 days', NULL, NULL),
  ('11111111-1111-1111-1111-111111111111', 'Dani Prado', 'Dani', '5511930000004', 'comprador', NULL,
   ((current_date - interval '6 months')::date + time '12:00')::timestamp AT TIME ZONE 'America/Sao_Paulo', 'higienizacao');

-- Campanha A preparada (esperando aprovação) e B com as mesmas listas.
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, grupos, datas_disparo, listas) VALUES
  ('fa000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Campanha A', 'calendario',
   date_trunc('month', current_date), '{}', ARRAY[current_date + 30], '[{"grupo": "N1", "familia": "orcamento", "ate": 90}]'),
  ('fa000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Campanha B', 'calendario',
   date_trunc('month', current_date), '{}', ARRAY[current_date + 31], '[{"grupo": "N1", "familia": "orcamento", "ate": 90}]');
SELECT public.mkt_preparar_campanha('fa000000-0000-0000-0000-00000000000a');
SELECT pg_temp.ok(pg_temp.envios('fa000000-0000-0000-0000-00000000000a') = 'Ana Prado,Bia Prado,Caio Prado',
  'A com os três: ' || pg_temp.envios('fa000000-0000-0000-0000-00000000000a'));

-- 1. Presas: as três estão fora de B só por causa de A.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE presas1 AS SELECT public.mkt_campanha_presas('fa000000-0000-0000-0000-00000000000b') AS r;
RESET ROLE;
SELECT pg_temp.ok((SELECT (r ->> 'total')::int = 3 AND r -> 'por_grupo' ->> 'N1' = '3'
                     AND r -> 'campanhas' -> 0 ->> 'nome' = 'Campanha A'
                     AND (r -> 'campanhas' -> 0 ->> 'pessoas')::int = 3 FROM presas1),
  'presas em A: ' || (SELECT r::text FROM presas1));

-- 2. Atendente não marca "já chamei manualmente".
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.mkt_marcar_chamado_manual('[{"telefone": "(11) 93000-0002"}]');
  RAISE EXCEPTION 'FALHOU: atendente marcou';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

-- 3. Admin: simulação conta sem gravar; depois marca Bia (há 5 dias) e Dani (há 10 dias).
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE sim AS SELECT public.mkt_marcar_chamado_manual(
  jsonb_build_array(jsonb_build_object('telefone', '(11) 93000-0002', 'data', current_date - 5),
                    jsonb_build_object('telefone', '11 99999-0000')), true) AS r;
CREATE TEMP TABLE marc AS SELECT public.mkt_marcar_chamado_manual(
  jsonb_build_array(jsonb_build_object('telefone', '+55 11 93000-0002', 'data', current_date - 5),
                    jsonb_build_object('telefone', '11930000004', 'data', current_date - 10),
                    jsonb_build_object('telefone', '11 99999-0000'))) AS r;
-- Data antiga depois não apaga a mais nova.
SELECT public.mkt_marcar_chamado_manual(jsonb_build_array(jsonb_build_object('telefone', '11930000002', 'data', current_date - 60)));
RESET ROLE;
SELECT pg_temp.ok((SELECT r ->> 'marcados' = '1' AND r -> 'nao_encontrados' ->> 0 = '11 99999-0000' FROM sim),
  'simulação: ' || (SELECT r::text FROM sim));
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_contatos WHERE chamado_manual_em IS NOT NULL AND nome LIKE '%Prado') = 2,
  'simulação não grava; marcação grava dois');
SELECT pg_temp.ok((SELECT chamado_manual_em = current_date - 5 FROM public.mkt_contatos WHERE nome = 'Bia Prado'),
  'fica a data mais recente');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_eventos WHERE tipo = 'chamado_manual') = 3, 'histórico registrado');

-- 4. A recusada: B prepara sem Bia (chamada à mão há 5 dias); nada mais preso.
SELECT public.mkt_encerrar_campanha('fa000000-0000-0000-0000-00000000000a', 'recusada', 'teste');
SELECT public.mkt_preparar_campanha('fa000000-0000-0000-0000-00000000000b');
SELECT pg_temp.ok(pg_temp.envios('fa000000-0000-0000-0000-00000000000b') = 'Ana Prado,Caio Prado',
  'B sem quem foi chamado à mão: ' || pg_temp.envios('fa000000-0000-0000-0000-00000000000b'));
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE presas2 AS SELECT public.mkt_campanha_presas('fa000000-0000-0000-0000-00000000000a') AS r;
RESET ROLE;
SELECT pg_temp.ok((SELECT (r ->> 'total')::int = 2 AND r -> 'campanhas' -> 0 ->> 'nome' = 'Campanha B' FROM presas2),
  'agora quem está preso é em B: ' || (SELECT r::text FROM presas2));

-- 5. Depois de 30 dias a pessoa volta.
UPDATE public.mkt_contatos SET chamado_manual_em = current_date - 31 WHERE nome = 'Bia Prado';
SELECT pg_temp.ok((SELECT private.mkt_motivo_fora(false, 30, x.optout, x.interno, x.sem_pos_venda, x.agendado_para,
                            x.primeiro_nome, x.ultimo_marketing_em) IS NULL
                     FROM private.mkt_listas_dados('11111111-1111-1111-1111-111111111111', NULL) x
                    WHERE x.nome = 'Bia Prado'), 'chamada há 31 dias pode receber');

-- 6. Lembrete de 6 meses de quem foi chamado à mão há 10 dias fica para depois.
CREATE TEMP TABLE gat AS SELECT public.mkt_gerar_gatilhos('11111111-1111-1111-1111-111111111111') AS r;
SELECT pg_temp.ok((SELECT (r -> 'C2' ->> 'adiados')::int = 1 AND (r -> 'C2' ->> 'novos')::int = 0 FROM gat),
  'lembrete adiado: ' || (SELECT r::text FROM gat));

ROLLBACK;
