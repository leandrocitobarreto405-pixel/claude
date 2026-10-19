-- Numeração sequencial de orçamento por empresa (aprovada em 19/10/2026).
--  * quotes.numero: 1, 2, 3... dentro de cada empresa, preenchido na criação por gatilho. O
--    contador fica em orcamento_contadores (uma linha por empresa); o INSERT ... ON CONFLICT DO
--    UPDATE ... RETURNING trava a linha da empresa até o fim da transação: duas criações ao
--    mesmo tempo não pegam o mesmo número, e uma criação que falha desfaz o aumento (sem buraco).
--  * Orçamentos existentes: numerados por ordem de criação dentro de cada empresa, sem mudar
--    nenhum outro dado (o gatilho do updated_at fica desligado só durante a numeração).
--  * O número não muda depois de criado. A numeração da OS (os_number) não é tocada.
-- Nada é apagado.

-- ---------------------------------------------------------------- contador por empresa
CREATE TABLE IF NOT EXISTS public.orcamento_contadores (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id),
  ultimo integer NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.orcamento_contadores ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.orcamento_contadores TO authenticated;
GRANT ALL ON public.orcamento_contadores TO service_role;
-- Só leitura da própria empresa; quem grava é a função do gatilho (SECURITY DEFINER).
CREATE POLICY orcamento_contadores_leitura ON public.orcamento_contadores FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));

-- ---------------------------------------------------------------- coluna
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS numero integer;
CREATE UNIQUE INDEX IF NOT EXISTS quotes_empresa_numero_key ON public.quotes (empresa_id, numero);

-- ---------------------------------------------------------------- existentes
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT e.nome, count(*) AS n FROM public.quotes q JOIN public.empresas e ON e.id = q.empresa_id
            WHERE q.numero IS NULL GROUP BY e.nome ORDER BY e.nome LOOP
    RAISE NOTICE 'Orçamentos a numerar — %: %', r.nome, r.n;
  END LOOP;
END $$;

ALTER TABLE public.quotes DISABLE TRIGGER trg_quotes_upd;
WITH ordem AS (
  SELECT id, row_number() OVER (PARTITION BY empresa_id ORDER BY created_at, id)
           + coalesce((SELECT max(numero) FROM public.quotes x WHERE x.empresa_id = q.empresa_id), 0) AS n
    FROM public.quotes q
   WHERE numero IS NULL
)
UPDATE public.quotes q SET numero = o.n FROM ordem o WHERE q.id = o.id;
ALTER TABLE public.quotes ENABLE TRIGGER trg_quotes_upd;

INSERT INTO public.orcamento_contadores (empresa_id, ultimo)
SELECT empresa_id, max(numero) FROM public.quotes GROUP BY empresa_id
ON CONFLICT (empresa_id) DO UPDATE SET ultimo = greatest(orcamento_contadores.ultimo, excluded.ultimo);

-- ---------------------------------------------------------------- criação
CREATE OR REPLACE FUNCTION private.quotes_numero()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    INSERT INTO public.orcamento_contadores AS c (empresa_id, ultimo, updated_at)
    VALUES (NEW.empresa_id, 1, now())
    ON CONFLICT (empresa_id) DO UPDATE SET ultimo = c.ultimo + 1, updated_at = now()
    RETURNING c.ultimo INTO NEW.numero;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.quotes_numero() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_quotes_numero BEFORE INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION private.quotes_numero();

-- O número não muda depois de criado.
CREATE OR REPLACE FUNCTION private.quotes_numero_fixo()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.numero IS DISTINCT FROM OLD.numero THEN
    RAISE EXCEPTION 'O número do orçamento não pode ser alterado.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.quotes_numero_fixo() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_quotes_numero_fixo BEFORE UPDATE OF numero ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION private.quotes_numero_fixo();

ALTER TABLE public.quotes ALTER COLUMN numero SET NOT NULL;
