-- Agenda real e feriados (02/11/2026), todas as empresas.
-- 1. Capacidade real: visits.ocupa_dia (true/false/null = automático) e
--    agenda_configuracoes.dia_inteiro_valor (soma do dia do técnico a partir deste valor ocupa o dia
--    inteiro; 0 = regra desligada). A regra de sobreposição pela duração fica no app.
-- 2. Feriados por empresa: calendário com nacionais, estado de SP e cidade de São Paulo (Páscoa
--    calculada), decisão "vamos trabalhar?" (null = sem decisão → dia bloqueado), semeado para as
--    empresas existentes (2026 e 2027) e para empresa nova (gatilho). Só o servidor grava; quem é da
--    empresa lê.
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS ocupa_dia boolean;
ALTER TABLE public.agenda_configuracoes
  ADD COLUMN IF NOT EXISTS dia_inteiro_valor numeric(12,2) NOT NULL DEFAULT 1000
    CHECK (dia_inteiro_valor >= 0);

CREATE TABLE IF NOT EXISTS public.feriados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  data date NOT NULL,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 2 AND 80),
  origem text NOT NULL DEFAULT 'manual'
    CHECK (origem IN ('nacional', 'estadual', 'municipal', 'facultativo', 'manual')),
  -- null = ninguém decidiu (vale "não trabalhamos"); true = dia normal; false = bloqueado.
  trabalhamos boolean,
  decidido_em timestamptz,
  decidido_por uuid,
  decidido_origem text CHECK (decidido_origem IS NULL OR decidido_origem IN ('admin', 'padrao')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, data)
);
CREATE INDEX IF NOT EXISTS idx_feriados_empresa_data ON public.feriados (empresa_id, data);

ALTER TABLE public.feriados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feriados FROM anon, authenticated;
GRANT SELECT ON public.feriados TO authenticated;
GRANT ALL ON public.feriados TO service_role;
DROP POLICY IF EXISTS feriados_select ON public.feriados;
CREATE POLICY feriados_select ON public.feriados FOR SELECT TO authenticated USING (
  empresa_id = (SELECT private.empresa_ativa()) OR (SELECT private.is_nexa_admin()));

-- Páscoa (domingo) pelo algoritmo de Meeus/Jones/Butcher.
CREATE OR REPLACE FUNCTION private.pascoa(_ano integer)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH v AS (
    SELECT _ano % 19 AS a, _ano / 100 AS b, _ano % 100 AS c
  ), w AS (
    SELECT a, b, c, b / 4 AS d, b % 4 AS e, (b + 8) / 25 AS f FROM v
  ), x AS (
    SELECT a, b, c, d, e, (b - f + 1) / 3 AS g FROM w
  ), y AS (
    SELECT a, c, e, (19 * a + b - d - g + 15) % 30 AS h, c / 4 AS i, c % 4 AS k FROM x
  ), z AS (
    SELECT a, h, (32 + 2 * e + 2 * i - h - k) % 7 AS l FROM y
  ), m AS (
    SELECT h, l, (a + 11 * h + 22 * l) / 451 AS mm FROM z
  )
  SELECT make_date(_ano, (h + l - 7 * mm + 114) / 31, (h + l - 7 * mm + 114) % 31 + 1) FROM m;
$$;

-- Calendário padrão de um ano: Brasil, estado de São Paulo e cidade de São Paulo.
CREATE OR REPLACE FUNCTION private.feriados_padrao(_ano integer)
RETURNS TABLE (data date, nome text, origem text) LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT make_date(_ano, 1, 1), 'Confraternização Universal', 'nacional'
  UNION ALL SELECT make_date(_ano, 1, 25), 'Aniversário de São Paulo', 'municipal'
  UNION ALL SELECT private.pascoa(_ano) - 48, 'Carnaval (segunda)', 'facultativo'
  UNION ALL SELECT private.pascoa(_ano) - 47, 'Carnaval (terça)', 'facultativo'
  UNION ALL SELECT private.pascoa(_ano) - 2, 'Sexta-feira Santa', 'nacional'
  UNION ALL SELECT make_date(_ano, 4, 21), 'Tiradentes', 'nacional'
  UNION ALL SELECT make_date(_ano, 5, 1), 'Dia do Trabalho', 'nacional'
  UNION ALL SELECT private.pascoa(_ano) + 60, 'Corpus Christi', 'municipal'
  UNION ALL SELECT make_date(_ano, 7, 9), 'Revolução Constitucionalista', 'estadual'
  UNION ALL SELECT make_date(_ano, 9, 7), 'Independência do Brasil', 'nacional'
  UNION ALL SELECT make_date(_ano, 10, 12), 'Nossa Senhora Aparecida', 'nacional'
  UNION ALL SELECT make_date(_ano, 11, 2), 'Finados', 'nacional'
  UNION ALL SELECT make_date(_ano, 11, 15), 'Proclamação da República', 'nacional'
  UNION ALL SELECT make_date(_ano, 11, 20), 'Dia da Consciência Negra', 'nacional'
  UNION ALL SELECT make_date(_ano, 12, 25), 'Natal', 'nacional'
  ORDER BY 1;
$$;

-- Semeia o calendário padrão do ano na empresa; o que já existe fica como está. Devolve quantos entraram.
CREATE OR REPLACE FUNCTION public.feriados_semear(_empresa uuid, _ano integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  n integer;
BEGIN
  IF _empresa IS NULL OR _ano IS NULL OR _ano < 2020 OR _ano > 2100 THEN
    RAISE EXCEPTION 'Empresa ou ano inválido.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.feriados (empresa_id, data, nome, origem)
  SELECT _empresa, p.data, p.nome, p.origem FROM private.feriados_padrao(_ano) p
  ON CONFLICT (empresa_id, data) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.feriados_semear(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feriados_semear(uuid, integer) TO service_role;

-- Dia bloqueado para a empresa: feriado sem "vamos trabalhar".
CREATE OR REPLACE FUNCTION public.dia_bloqueado(_empresa uuid, _data date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.feriados f
     WHERE f.empresa_id = _empresa AND f.data = _data AND f.trabalhamos IS DISTINCT FROM true);
$$;
REVOKE ALL ON FUNCTION public.dia_bloqueado(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dia_bloqueado(uuid, date) TO authenticated, service_role;

-- Empresa nova já nasce com o calendário do ano e do seguinte.
CREATE OR REPLACE FUNCTION private.empresas_semear_feriados()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ano integer := extract(year FROM private.hoje_sp())::integer;
BEGIN
  PERFORM public.feriados_semear(NEW.id, ano);
  PERFORM public.feriados_semear(NEW.id, ano + 1);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_empresas_semear_feriados ON public.empresas;
CREATE TRIGGER trg_empresas_semear_feriados AFTER INSERT ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION private.empresas_semear_feriados();

-- Empresas existentes: 2026 e 2027.
SELECT public.feriados_semear(e.id, a) FROM public.empresas e CROSS JOIN (VALUES (2026), (2027)) AS anos(a);

SELECT private.instalar_travas_somente_leitura();
