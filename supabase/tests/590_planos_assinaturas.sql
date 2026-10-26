-- Planos e assinaturas (migração 20261203120000): catálogo global só a Nexa altera, assinatura
-- com vigência, empresa só lê a própria, "vendido por" pela vendedora e o % do contrato vigente
-- na data da venda. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.como(_email text, _empresa uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false),
         set_config('request.headers',
           CASE WHEN _empresa IS NULL THEN '{}' ELSE json_build_object('x-empresa-id', _empresa)::text END, false);
$$;
CREATE FUNCTION pg_temp.deve_falhar(_sql text, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU (deveria ter sido bloqueado): %', _msg;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

\set E '59000000-0000-0000-0000-00000000000e'
\set F '59000000-0000-0000-0000-00000000000f'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 590'), (:'F', 'Outra Fictícia 590');
INSERT INTO auth.users (email) VALUES ('nexa590@nexa.test'), ('admin590@e.test'), ('admin590@f.test');
INSERT INTO public.plataforma_usuarios (user_id, papel)
SELECT id, 'nexa_admin' FROM auth.users WHERE email = 'nexa590@nexa.test';
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E', 'admin' FROM auth.users WHERE email = 'admin590@e.test';
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'F', 'admin' FROM auth.users WHERE email = 'admin590@f.test';

-- Catálogo inicial (decisão A).
SELECT pg_temp.ok((SELECT count(*) FROM public.planos WHERE codigo IN ('basico', 'completo', 'nexa_gestao', 'interna')) = 4,
  'quatro planos');
SELECT pg_temp.ok((SELECT preco_mensal = 50 AND NOT (recursos->>'alice')::boolean FROM public.planos WHERE codigo = 'basico'),
  'básico R$ 50 sem Alice');
-- Nexa Gestão ganhou preço na migração 20261215120000 (R$ 497 + 5%).
SELECT pg_temp.ok((SELECT preco_mensal = 497 AND comissao_pct = 5 FROM public.planos WHERE codigo = 'nexa_gestao'),
  'Nexa Gestão: R$ 497 e 5%');
SELECT pg_temp.ok((SELECT preco_mensal = 0 FROM public.planos WHERE codigo = 'interna'), 'interna R$ 0');
-- Turbine (empresa de teste do banco): Interna.
SELECT pg_temp.ok((SELECT p.codigo = 'interna' AND a.status = 'ativa' FROM public.assinaturas a
                     JOIN public.planos p ON p.id = a.plano_id
                    WHERE a.empresa_id = '11111111-1111-1111-1111-111111111111' AND a.vigencia_fim IS NULL),
  'Turbine no plano Interna');

-- A empresa lê o catálogo, mas não altera.
SELECT pg_temp.como('admin590@e.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.planos) >= 4, 'empresa lê os planos');
UPDATE public.planos SET preco_mensal = 1 WHERE codigo = 'basico';
RESET ROLE;
SELECT pg_temp.ok((SELECT preco_mensal = 50 FROM public.planos WHERE codigo = 'basico'), 'empresa não altera plano');

-- A Nexa define a assinatura; a empresa não.
SELECT pg_temp.como('admin590@e.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.deve_falhar($$SELECT public.definir_assinatura('59000000-0000-0000-0000-00000000000e', 'basico', '2026-10-01')$$,
  'empresa definindo a própria assinatura');
RESET ROLE;
SELECT pg_temp.como('nexa590@nexa.test');
SET ROLE authenticated;
SELECT public.definir_assinatura(:'E', 'nexa_gestao', '2026-10-03', NULL, 'trial', '2027-01-02', '2027-01-03');
SELECT public.definir_assinatura(:'F', 'basico', '2026-10-01');
-- Troca de plano em data posterior: fecha a vigência anterior.
SELECT public.definir_assinatura(:'F', 'completo', '2026-11-01', 250);
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) = 2 AND count(*) FILTER (WHERE vigencia_fim = '2026-10-31') = 1
                     FROM public.assinaturas WHERE empresa_id = :'F'), 'troca fecha a vigência anterior');
SELECT pg_temp.ok((SELECT a.valor_mensal = 250 FROM public.assinaturas a WHERE a.empresa_id = :'F' AND a.vigencia_fim IS NULL),
  'valor próprio da empresa');

-- Cada empresa só lê a própria assinatura.
SELECT pg_temp.como('admin590@f.test', :'F');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.assinaturas WHERE empresa_id = '59000000-0000-0000-0000-00000000000e') = 0,
  'não lê a assinatura da outra empresa');
SELECT pg_temp.ok((SELECT count(*) FROM public.assinaturas WHERE empresa_id = '59000000-0000-0000-0000-00000000000f') = 2,
  'lê a própria');
UPDATE public.assinaturas SET status = 'ativa' WHERE empresa_id = '59000000-0000-0000-0000-00000000000f';
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.assinaturas WHERE empresa_id = :'F' AND status = 'ativa') = 2,
  'status sem mudança (a empresa não grava)');

-- Vendido por: atendente da Nexa ou Alice = nexa; vendedora da empresa = empresa.
INSERT INTO public.salespeople (id, empresa_id, name, atendente_nexa, eh_ia) VALUES
  ('59000000-0000-0000-0000-0000000000a1', :'E', 'Atendente Nexa', true, false),
  ('59000000-0000-0000-0000-0000000000a2', :'E', 'Vendedora da Empresa', false, false),
  ('59000000-0000-0000-0000-0000000000a3', :'E', 'IA', false, true);
INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('59000000-0000-0000-0000-0000000000c1', :'E', 'Cliente Fictício', '11975900001');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, salesperson_id) VALUES
  ('59000000-0000-0000-0000-0000000000b1', :'E', '59001', '59000000-0000-0000-0000-0000000000c1', 100, '59000000-0000-0000-0000-0000000000a1'),
  ('59000000-0000-0000-0000-0000000000b2', :'E', '59002', '59000000-0000-0000-0000-0000000000c1', 100, '59000000-0000-0000-0000-0000000000a2'),
  ('59000000-0000-0000-0000-0000000000b3', :'E', '59003', '59000000-0000-0000-0000-0000000000c1', 100, '59000000-0000-0000-0000-0000000000a3'),
  ('59000000-0000-0000-0000-0000000000b4', :'E', '59004', '59000000-0000-0000-0000-0000000000c1', 100, NULL);
SELECT pg_temp.ok((SELECT string_agg(vendido_por, ',' ORDER BY os_number) FROM public.work_orders WHERE empresa_id = :'E')
                  = 'nexa,empresa,nexa,empresa', 'vendido por pela vendedora');
-- Ninguém grava o "vendido por" à mão: vale a vendedora.
UPDATE public.work_orders SET vendido_por = 'nexa' WHERE id = '59000000-0000-0000-0000-0000000000b2';
SELECT pg_temp.ok((SELECT vendido_por = 'empresa' FROM public.work_orders WHERE id = '59000000-0000-0000-0000-0000000000b2'),
  'vendido por não se escreve à mão');
UPDATE public.work_orders SET salesperson_id = '59000000-0000-0000-0000-0000000000a1'
 WHERE id = '59000000-0000-0000-0000-0000000000b2';
SELECT pg_temp.ok((SELECT vendido_por = 'nexa' FROM public.work_orders WHERE id = '59000000-0000-0000-0000-0000000000b2'),
  'troca de vendedora atualiza');

-- % vigente na data da venda (decisão D).
INSERT INTO public.contratos_comissao (empresa_id, percentual, vigencia_inicio, vigencia_fim) VALUES
  (:'E', 5, '2026-10-03', '2026-11-30'), (:'E', 7, '2026-12-01', NULL);
SELECT pg_temp.ok(private.comissao_nexa_pct(:'E', '2026-11-30') = 5, '% de novembro');
SELECT pg_temp.ok(private.comissao_nexa_pct(:'E', '2026-12-01') = 7, '% de dezembro');
SELECT pg_temp.ok(private.comissao_nexa_pct(:'E', '2026-10-01') IS NULL, 'antes do contrato: sem %');
ROLLBACK;
