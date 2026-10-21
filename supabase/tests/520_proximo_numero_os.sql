-- Próximo número de OS por empresa: maior usado + 1, ou o "próximo número" do Painel Nexa se
-- for maior; o campo só aumenta e nunca fica abaixo do maior usado. Dados fictícios.
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

\set E '52000000-0000-0000-0000-00000000000e'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 520');

-- Sem OS nenhuma: começa em 0001.
SELECT pg_temp.ok(public.proximo_numero_os(:'E') = '0001', 'sem OS: 0001');

INSERT INTO public.customers (id, empresa_id, full_name, phone)
VALUES ('52000000-0000-0000-0000-0000000000c1', :'E', 'Cliente Fictício 520', '11970005200');
INSERT INTO public.work_orders (empresa_id, os_number, customer_id, status, sale_date)
VALUES (:'E', '0003', '52000000-0000-0000-0000-0000000000c1', 'Agendada', current_date),
       (:'E', 'TESTE-X', '52000000-0000-0000-0000-0000000000c1', 'Agendada', current_date);
SELECT pg_temp.ok(public.proximo_numero_os(:'E') = '0004', 'maior usado 0003: próximo 0004 (ignora não numérico)');

-- Painel Nexa define 1500: a próxima vira 1500.
UPDATE public.empresas SET proximo_numero_os = 1500 WHERE id = :'E';
SELECT pg_temp.ok(public.proximo_numero_os(:'E') = '1500', 'próximo configurado 1500');

-- Nunca diminui, nunca abaixo do maior usado, nunca apagado.
SELECT pg_temp.deve_falhar($$UPDATE public.empresas SET proximo_numero_os = 1499 WHERE id = '52000000-0000-0000-0000-00000000000e'$$, 'diminuir');
SELECT pg_temp.deve_falhar($$UPDATE public.empresas SET proximo_numero_os = NULL WHERE id = '52000000-0000-0000-0000-00000000000e'$$, 'apagar');

-- Depois da OS 1500 criada, a próxima é 1501 (o campo fica para trás sem atrapalhar).
INSERT INTO public.work_orders (empresa_id, os_number, customer_id, status, sale_date)
VALUES (:'E', '1500', '52000000-0000-0000-0000-0000000000c1', 'Agendada', current_date);
SELECT pg_temp.ok(public.proximo_numero_os(:'E') = '1501', 'depois da 1500: 1501');
-- Mesmo valor de antes: nada muda, sem erro. Subir para um número já usado: bloqueado.
UPDATE public.empresas SET proximo_numero_os = 1500 WHERE id = :'E';
INSERT INTO public.work_orders (empresa_id, os_number, customer_id, status, sale_date)
VALUES (:'E', '1600', '52000000-0000-0000-0000-0000000000c1', 'Agendada', current_date);
SELECT pg_temp.deve_falhar($$UPDATE public.empresas SET proximo_numero_os = 1550 WHERE id = '52000000-0000-0000-0000-00000000000e'$$, 'abaixo do maior usado (1600)');
SELECT pg_temp.deve_falhar($$UPDATE public.empresas SET proximo_numero_os = 1600 WHERE id = '52000000-0000-0000-0000-00000000000e'$$, 'igual ao maior usado (1600)');
UPDATE public.empresas SET proximo_numero_os = 2000 WHERE id = :'E';
SELECT pg_temp.ok(public.proximo_numero_os(:'E') = '2000', 'subiu para 2000');

ROLLBACK;
