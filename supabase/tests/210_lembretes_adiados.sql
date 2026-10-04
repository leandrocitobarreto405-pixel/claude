-- Lembretes de 6 meses e 13º mês: quem recebeu campanha ou promoção há menos de 30 dias fica para
-- o dia em que completar os 30 dias (se ainda estiver na janela), e a aprovação mostra quantos
-- ficaram para depois. Quem só entrou na base depois da janela não recebe lembrete atrasado.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.dia(_d date) RETURNS timestamptz LANGUAGE sql AS $$
  SELECT (_d + time '12:00') AT TIME ZONE 'America/Sao_Paulo'
$$;
CREATE FUNCTION pg_temp.quem(_prefixo text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(c.nome, ' ' ORDER BY c.nome), '')
    FROM public.mkt_envios e JOIN public.mkt_contatos c ON c.id = e.contato_id
   WHERE e.gatilho_ref LIKE _prefixo || ':%'
$$;

-- Higienização em 10/02/2026: janela do lembrete de 6 meses de 10/08 a 16/08, adiado até 10/09.
--   Rui: nada recente, sai no dia.
--   Sol: promoção em 25/07, completa 30 dias em 24/08 (ainda na janela): fica para 24/08.
--   Tom: promoção marcada para 15/08, só completaria em 14/09 (fora da janela): perde o lembrete.
--   Uva: higienização em 01/02/2026, entrou depois da janela (01/08 a 07/08): sem lembrete atrasado.
-- Impermeabilização em 20/07/2025: janela do 13º mês de 04/08 a 20/08/2026.
--   Vera: promoção em 30/07, completaria em 29/08: perde o lembrete.
--   Zeca: promoção em 15/07, completa em 14/08: fica para 14/08.
INSERT INTO public.mkt_contatos (empresa_id, nome, primeiro_nome, normalized_phone, tipo, ultimo_servico_em,
  ultimo_servico_tipo) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Rui Livre', 'Rui', '5511930000001', 'comprador', pg_temp.dia('2026-02-10'), 'higienizacao'),
  ('11111111-1111-1111-1111-111111111111', 'Sol Promo', 'Sol', '5511930000002', 'comprador', pg_temp.dia('2026-02-10'), 'higienizacao'),
  ('11111111-1111-1111-1111-111111111111', 'Tom Tarde', 'Tom', '5511930000003', 'comprador', pg_temp.dia('2026-02-10'), 'higienizacao'),
  ('11111111-1111-1111-1111-111111111111', 'Uva Importada', 'Uva', '5511930000004', 'comprador', pg_temp.dia('2026-02-01'), 'higienizacao'),
  ('11111111-1111-1111-1111-111111111111', 'Vera Imper', 'Vera', '5511930000005', 'comprador', pg_temp.dia('2025-07-20'), 'impermeabilizacao'),
  ('11111111-1111-1111-1111-111111111111', 'Zeca Imper', 'Zeca', '5511930000006', 'comprador', pg_temp.dia('2025-07-20'), 'impermeabilizacao');
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, status)
VALUES ('f9100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Promo de julho',
        'promocao', '2026-07-01', 'concluida');
INSERT INTO public.mkt_envios (empresa_id, campanha_id, contato_id, normalized_phone, template_nome, status, enviado_em, agendado_para)
SELECT c.empresa_id, 'f9100000-0000-0000-0000-000000000001', c.id, c.normalized_phone, 'tc_promocao_agenda', x.status,
       CASE WHEN x.status = 'enviado' THEN pg_temp.dia(x.d) END, pg_temp.dia(x.d)
  FROM public.mkt_contatos c
  JOIN (VALUES ('Sol Promo', '2026-07-25'::date, 'enviado'), ('Tom Tarde', '2026-08-15'::date, 'pendente'),
               ('Vera Imper', '2026-07-30'::date, 'enviado'), ('Zeca Imper', '2026-07-15'::date, 'enviado')) x(nome, d, status)
    ON x.nome = c.nome;
INSERT INTO public.mkt_configuracoes (empresa_id, gatilho_c2_ligado, gatilho_c3_ligado)
VALUES ('11111111-1111-1111-1111-111111111111', true, true)
ON CONFLICT (empresa_id) DO UPDATE SET gatilho_c2_ligado = true, gatilho_c3_ligado = true;

-- 1. 10/08: Rui sai; Sol fica para depois; Tom e Uva não entram. No 13º mês, Zeca fica para depois.
CREATE TEMP TABLE g1 AS SELECT public.mkt_gerar_gatilhos('11111111-1111-1111-1111-111111111111', '2026-08-10') AS r;
SELECT pg_temp.ok((SELECT (r->'C2'->>'novos')::int = 1 AND (r->'C2'->>'adiados')::int = 1
                      AND (r->'C3'->>'novos')::int = 0 AND (r->'C3'->>'adiados')::int = 1 FROM g1),
  '10/08: ' || (SELECT r::text FROM g1));
SELECT pg_temp.ok(pg_temp.quem('C2') = 'Rui Livre', 'C2 em 10/08: ' || pg_temp.quem('C2'));
SELECT pg_temp.ok((SELECT l.adiados FROM public.mkt_lotes l JOIN public.mkt_envios e ON e.lote_id = l.id
                    WHERE e.gatilho_ref LIKE 'C2:%') = 1, 'lote guarda quantos ficaram para depois');
SELECT pg_temp.ok((SELECT mensagem LIKE '%1 ficou para depois (campanha ou promoção há menos de 30 dias)%'
                     FROM public.mkt_avisos WHERE tipo = 'lembretes_aprovacao' ORDER BY created_at DESC LIMIT 1),
  'aviso conta quem ficou para depois');

-- 2. 14/08: Zeca completou os 30 dias e sai; Sol continua esperando.
CREATE TEMP TABLE g2 AS SELECT public.mkt_gerar_gatilhos('11111111-1111-1111-1111-111111111111', '2026-08-14') AS r;
SELECT pg_temp.ok((SELECT (r->'C3'->>'novos')::int = 1 AND (r->'C3'->>'adiados')::int = 0
                      AND (r->'C2'->>'novos')::int = 0 AND (r->'C2'->>'adiados')::int = 1 FROM g2),
  '14/08: ' || (SELECT r::text FROM g2));
SELECT pg_temp.ok(pg_temp.quem('C3') = 'Zeca Imper', 'C3: ' || pg_temp.quem('C3'));

-- 3. 23/08 (já depois da janela normal): Sol ainda espera. 24/08: Sol sai.
CREATE TEMP TABLE g3 AS SELECT public.mkt_gerar_gatilhos('11111111-1111-1111-1111-111111111111', '2026-08-23') AS r;
SELECT pg_temp.ok((SELECT (r->'C2'->>'novos')::int = 0 AND (r->'C2'->>'adiados')::int = 1 FROM g3),
  '23/08: ' || (SELECT r::text FROM g3));
CREATE TEMP TABLE g4 AS SELECT public.mkt_gerar_gatilhos('11111111-1111-1111-1111-111111111111', '2026-08-24') AS r;
SELECT pg_temp.ok((SELECT (r->'C2'->>'novos')::int = 1 AND (r->'C2'->>'adiados')::int = 0 FROM g4),
  '24/08: ' || (SELECT r::text FROM g4));
SELECT pg_temp.ok(pg_temp.quem('C2') = 'Rui Livre Sol Promo', 'C2 no fim: ' || pg_temp.quem('C2'));

-- 4. 14/09: ninguém mais (Tom completaria hoje, mas a janela acabou em 10/09; Uva e Vera nunca).
CREATE TEMP TABLE g5 AS SELECT public.mkt_gerar_gatilhos('11111111-1111-1111-1111-111111111111', '2026-09-14') AS r;
SELECT pg_temp.ok((SELECT (r->'C2'->>'novos')::int = 0 AND (r->'C2'->>'adiados')::int = 0 FROM g5),
  '14/09: ' || (SELECT r::text FROM g5));
SELECT pg_temp.ok(pg_temp.quem('C2') NOT LIKE '%Tom%' AND pg_temp.quem('C2') NOT LIKE '%Uva%'
               AND pg_temp.quem('C3') NOT LIKE '%Vera%', 'sem lembrete atrasado');

-- 5. Sem nenhum envio de verdade: tudo esperando aprovação (nada sai sozinho).
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_envios WHERE gatilho_ref IS NOT NULL AND status NOT IN ('pendente'))
                  = 0, 'só pendentes');
SELECT pg_temp.ok((SELECT bool_and(l.status = 'aguardando_aprovacao') FROM public.mkt_lotes l
                    JOIN public.mkt_campanhas k ON k.id = l.campanha_id WHERE k.gatilho IN ('C2', 'C3')),
  'lotes esperando aprovação');
ROLLBACK;
