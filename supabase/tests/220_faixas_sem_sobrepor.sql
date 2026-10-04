-- Faixas das listas sem sobreposição: "até Y" inclui Y; "de X" começa em X + 1.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
SELECT pg_temp.ok(private.mkt_no_intervalo(90, '{"ate": 90}')
               AND NOT private.mkt_no_intervalo(90, '{"de": 90, "ate": 365}'), '90 dias só em "até 90"');
SELECT pg_temp.ok(private.mkt_no_intervalo(91, '{"de": 90, "ate": 365}')
               AND NOT private.mkt_no_intervalo(91, '{"ate": 90}'), '91 dias começa a faixa de 90 a 365');
SELECT pg_temp.ok(private.mkt_no_intervalo(365, '{"de": 90, "ate": 365}')
               AND private.mkt_no_intervalo(365, '{"ate": 365}')
               AND NOT private.mkt_no_intervalo(365, '{"de": 365}'), '365 dias fica em "até 1 ano", não em "mais de 1 ano"');
SELECT pg_temp.ok(private.mkt_no_intervalo(366, '{"de": 365}'), '366 dias é "mais de 1 ano"');
SELECT pg_temp.ok(private.mkt_no_intervalo(0, '{}') AND private.mkt_no_intervalo(0, '{"ate": 10}')
               AND NOT private.mkt_no_intervalo(NULL, '{}'), 'sem data fica fora; dia 0 entra');
-- Cada dia de 0 a 800 cai em exatamente uma das faixas da campanha (até 90 / 91 a 365 / mais de 365).
SELECT pg_temp.ok((SELECT bool_and((private.mkt_no_intervalo(d, '{"ate": 90}')::int
                                    + private.mkt_no_intervalo(d, '{"de": 90, "ate": 365}')::int
                                    + private.mkt_no_intervalo(d, '{"de": 365}')::int) = 1)
                     FROM generate_series(0, 800) d), 'cada dia em uma faixa só');
ROLLBACK;
