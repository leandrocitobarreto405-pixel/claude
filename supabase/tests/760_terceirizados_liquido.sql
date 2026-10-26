-- Terceirizados (migração 20261220120000): limpeza ou impermeabilização pela descrição da linha,
-- repasse editado pelo admin por OS, OS abertas atualizadas com o custo novo da tabela (concluídas
-- ficam). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.como(_email text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;
\set E '76000000-0000-4000-8000-000000000001'
\set O '76000000-0000-4000-8000-000000000002'

INSERT INTO auth.users (email) VALUES ('admin760@e.test'), ('tec760@e.test'), ('outra760@e.test');
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Terceirizados 760'), (:'O', 'Outra 760');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E'::uuid, 'admin'::public.papel_empresa FROM auth.users WHERE email = 'admin760@e.test'
UNION ALL SELECT id, :'E'::uuid, 'tecnico' FROM auth.users WHERE email = 'tec760@e.test'
UNION ALL SELECT id, :'O'::uuid, 'admin' FROM auth.users WHERE email = 'outra760@e.test';

INSERT INTO public.config_options (id, empresa_id, kind, name, display_order) VALUES
  ('76000000-0000-4000-8000-0000000000a1', :'E', 'service_type', 'Impermeabilização', 2);
INSERT INTO public.technicians (id, empresa_id, name, parceiro)
VALUES ('76000000-0000-4000-8000-0000000000b1', :'E', 'Parceiro Fictício 760', true);
-- Tapete: limpeza pelo parceiro (30/m²); impermeabilização feita pela empresa (custo preenchido por
-- engano na tabela: não vale).
INSERT INTO public.tabela_precos_itens (id, empresa_id, nome, preco_higienizacao, preco_impermeabilizacao,
  categoria, terceirizado, custo_parceiro, custo_parceiro_impermeabilizacao, parceiro_id) VALUES
  ('76000000-0000-4000-8000-0000000000c1', :'E', 'Tapete fictício 760 (por m²)', 60, 100, 'tapete', true, 30, 55,
   '76000000-0000-4000-8000-0000000000b1'),
  ('76000000-0000-4000-8000-0000000000c2', :'E', 'Cortina fictícia 760', 80, 120, 'outro', true, 40, 50,
   '76000000-0000-4000-8000-0000000000b1');

INSERT INTO public.customers (id, empresa_id, full_name, phone)
VALUES ('76000000-0000-4000-8000-0000000000d1', :'E', 'Cliente Fictício 760', '11976000001');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date,
  commission_percentage_snapshot, commission_expected) VALUES
  ('76000000-0000-4000-8000-0000000000e1', :'E', '76001', '76000000-0000-4000-8000-0000000000d1', 680, current_date, 10, 68),
  ('76000000-0000-4000-8000-0000000000e2', :'E', '76002', '76000000-0000-4000-8000-0000000000d1', 120, current_date, 10, 12);
-- OS 76001: atendimento do tipo Impermeabilização com limpeza e impermeabilização do tapete.
INSERT INTO public.visits (id, empresa_id, work_order_id, scheduled_date, scheduled_time, status, visit_value,
  service_type_id) VALUES
  ('76000000-0000-4000-8000-0000000000f1', :'E', '76000000-0000-4000-8000-0000000000e1', current_date, '09:00',
   'Agendado', 680, '76000000-0000-4000-8000-0000000000a1'),
  ('76000000-0000-4000-8000-0000000000f2', :'E', '76000000-0000-4000-8000-0000000000e2', current_date, '14:00',
   'Agendado', 120, NULL);
INSERT INTO public.service_items (id, empresa_id, visit_id, description, quantity, unit_price, subtotal, unidade) VALUES
  ('76000000-0000-4000-8000-000000000101', :'E', '76000000-0000-4000-8000-0000000000f1',
   'Tapete fictício 760 (por m²) — Limpeza', 8, 60, 480, 'm2'),
  ('76000000-0000-4000-8000-000000000102', :'E', '76000000-0000-4000-8000-0000000000f1',
   'Tapete fictício 760 (por m²) — Impermeabilização', 2, 100, 200, 'm2'),
  ('76000000-0000-4000-8000-000000000103', :'E', '76000000-0000-4000-8000-0000000000f2',
   'Tapete fictício 760 (por m²) — Limpeza', 2, 60, 120, 'm2');

-- 1) a limpeza tem repasse mesmo com o atendimento de impermeabilização; a impermeabilização não
SELECT pg_temp.ok((SELECT custo_parceiro_unitario || '/' || repasse_parceiro FROM public.service_items
                    WHERE id = '76000000-0000-4000-8000-000000000101') = '30.00/240.00',
  'limpeza num atendimento de impermeabilização: 8 m² × 30');
SELECT pg_temp.ok((SELECT custo_parceiro_unitario IS NULL AND parceiro_id IS NULL AND repasse_parceiro = 0
                     AND tabela_preco_item_id = '76000000-0000-4000-8000-0000000000c1'
                     FROM public.service_items WHERE id = '76000000-0000-4000-8000-000000000102'),
  'impermeabilização de tapete sem parceiro nem repasse (custo da tabela ignorado)');
-- Outros itens terceirizados: a impermeabilização usa o custo de impermeabilização.
INSERT INTO public.service_items (id, empresa_id, visit_id, description, quantity, unit_price, subtotal, unidade)
VALUES ('76000000-0000-4000-8000-000000000105', :'E', '76000000-0000-4000-8000-0000000000f1',
        'Cortina fictícia 760 — Impermeabilização', 1, 120, 120, 'un');
SELECT pg_temp.ok((SELECT repasse_parceiro FROM public.service_items WHERE id = '76000000-0000-4000-8000-000000000105') = 50,
  'cortina impermeabilizada pelo parceiro: 50');
UPDATE public.service_items SET active = false WHERE id = '76000000-0000-4000-8000-000000000105';
SELECT pg_temp.ok((SELECT repasse_parceiro FROM public.visits WHERE id = '76000000-0000-4000-8000-0000000000f1') = 240,
  'repasse do atendimento 240');

-- 2) comissão no valor cheio (o que o app gravou)
SELECT pg_temp.ok((SELECT commission_expected FROM public.work_orders WHERE os_number = '76001') = 68,
  'comissão cheia');

-- 3) técnico e admin de outra empresa não editam o repasse; o admin edita
SELECT pg_temp.como('tec760@e.test');
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM public.editar_repasse_linha('76000000-0000-4000-8000-000000000101', 10);
  RAISE EXCEPTION 'FALHOU: técnico editou o repasse';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT pg_temp.como('outra760@e.test');
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM public.editar_repasse_linha('76000000-0000-4000-8000-000000000101', 10);
  RAISE EXCEPTION 'FALHOU: outra empresa editou o repasse';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM public.os_abertas_do_item('76000000-0000-4000-8000-0000000000c1');
  RAISE EXCEPTION 'FALHOU: outra empresa viu as OS do item';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT pg_temp.como('admin760@e.test');
SET ROLE authenticated;
SELECT pg_temp.ok(public.editar_repasse_linha('76000000-0000-4000-8000-000000000101', 25) = 200,
  'admin edita: 8 m² × 25 = 200');
DO $$ BEGIN
  PERFORM public.editar_repasse_linha('76000000-0000-4000-8000-000000000101', -1);
  RAISE EXCEPTION 'FALHOU: aceitou custo negativo';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
RESET ROLE;
SELECT pg_temp.ok((SELECT repasse_editado FROM public.service_items WHERE id = '76000000-0000-4000-8000-000000000101'),
  'linha marcada como editada');
-- Quantidade muda: o custo editado fica.
UPDATE public.service_items SET quantity = 9 WHERE id = '76000000-0000-4000-8000-000000000101';
SELECT pg_temp.ok((SELECT repasse_parceiro FROM public.service_items WHERE id = '76000000-0000-4000-8000-000000000101') = 225,
  'editado: 9 m² × 25');

-- 4) custo novo na tabela: só OS abertas e não editadas; concluída fica
UPDATE public.visits SET status = 'Concluído', completion_date = current_date
 WHERE id = '76000000-0000-4000-8000-0000000000f2';
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date)
VALUES ('76000000-0000-4000-8000-0000000000e3', :'E', '76003', '76000000-0000-4000-8000-0000000000d1', 60, current_date);
INSERT INTO public.visits (id, empresa_id, work_order_id, scheduled_date, scheduled_time, status, visit_value)
VALUES ('76000000-0000-4000-8000-0000000000f3', :'E', '76000000-0000-4000-8000-0000000000e3', current_date, '16:00',
        'Agendado', 60);
INSERT INTO public.service_items (id, empresa_id, visit_id, description, quantity, unit_price, subtotal, unidade)
VALUES ('76000000-0000-4000-8000-000000000104', :'E', '76000000-0000-4000-8000-0000000000f3',
        'Tapete fictício 760 (por m²) — Limpeza', 1, 60, 60, 'm2');
UPDATE public.tabela_precos_itens SET custo_parceiro = 35 WHERE id = '76000000-0000-4000-8000-0000000000c1';

SELECT pg_temp.como('admin760@e.test');
SET ROLE authenticated;
SELECT set_config('teste.abertas', public.os_abertas_do_item('76000000-0000-4000-8000-0000000000c1')::text, false);
RESET ROLE;
-- 76001: limpeza editada e impermeabilização ficam fora; 76003 entra.
SELECT pg_temp.ok((current_setting('teste.abertas')::jsonb->>'linhas')::int = 1
                  AND current_setting('teste.abertas')::jsonb->'os' @> '["76003"]'
                  AND NOT current_setting('teste.abertas')::jsonb->'os' @> '["76002"]',
  'OS abertas do item: ' || current_setting('teste.abertas'));

SELECT pg_temp.como('tec760@e.test');
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM public.atualizar_repasse_os_abertas('76000000-0000-4000-8000-0000000000c1');
  RAISE EXCEPTION 'FALHOU: técnico atualizou as OS';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT pg_temp.como('admin760@e.test');
SET ROLE authenticated;
SELECT pg_temp.ok(public.atualizar_repasse_os_abertas('76000000-0000-4000-8000-0000000000c1') = 1, '1 linha atualizada');
RESET ROLE;
SELECT pg_temp.ok((SELECT repasse_parceiro FROM public.service_items WHERE id = '76000000-0000-4000-8000-000000000104') = 35,
  'OS aberta com o custo novo');
SELECT pg_temp.ok((SELECT repasse_parceiro FROM public.service_items WHERE id = '76000000-0000-4000-8000-000000000103') = 60,
  'OS concluída com o custo antigo (2 × 30)');
SELECT pg_temp.ok((SELECT repasse_parceiro FROM public.service_items WHERE id = '76000000-0000-4000-8000-000000000101') = 225,
  'linha editada não muda');
SELECT pg_temp.ok((SELECT repasse_parceiro FROM public.service_items WHERE id = '76000000-0000-4000-8000-000000000102') = 0,
  'impermeabilização continua sem repasse');

-- 5) trocar a descrição para impermeabilização tira o repasse (e a marca de editado)
UPDATE public.service_items SET description = 'Tapete fictício 760 (por m²) — Impermeabilização'
 WHERE id = '76000000-0000-4000-8000-000000000104';
SELECT pg_temp.ok((SELECT repasse_parceiro = 0 AND NOT repasse_editado FROM public.service_items
                    WHERE id = '76000000-0000-4000-8000-000000000104'), 'virou impermeabilização: sem repasse');

ROLLBACK;
