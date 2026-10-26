-- Cupons por empresa com tela própria (decisão de 26/10/2026). A Alice continua lendo esta tabela.
-- 1. Desconto em reais (valor) OU em percentual: exatamente um dos dois.
-- 2. valido_ate: último dia de validade (vazio = sem prazo).
-- 3. origem_id: a origem do lead ligada ao cupom (ex.: Site (orgânico), Blog). O canal (usado pela
--    Alice para oferecer o cupom do mesmo canal no outro serviço) continua.
-- Os cupons existentes ficam iguais; só ganham a origem pelo canal (SITE → Site, BLOG → Blog).

ALTER TABLE public.cupons ALTER COLUMN valor DROP NOT NULL;
ALTER TABLE public.cupons
  ADD COLUMN IF NOT EXISTS percentual numeric(5,2) CHECK (percentual IS NULL OR (percentual > 0 AND percentual <= 100)),
  ADD COLUMN IF NOT EXISTS valido_ate date,
  ADD COLUMN IF NOT EXISTS origem_id uuid REFERENCES public.config_options(id) ON DELETE SET NULL;
DO $$
BEGIN
  ALTER TABLE public.cupons ADD CONSTRAINT cupons_valor_ou_percentual
    CHECK ((valor IS NOT NULL) <> (percentual IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Código em maiúsculas; a origem do cupom é da mesma empresa.
CREATE OR REPLACE FUNCTION private.cupons_conferir()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.codigo := upper(btrim(NEW.codigo));
  IF NEW.origem_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.config_options o
        WHERE o.id = NEW.origem_id AND o.empresa_id = NEW.empresa_id AND o.kind = 'sales_origin') THEN
    RAISE EXCEPTION 'Origem do cupom inválida.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.cupons_conferir() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cupons_conferir ON public.cupons;
CREATE TRIGGER trg_cupons_conferir BEFORE INSERT OR UPDATE ON public.cupons
  FOR EACH ROW EXECUTE FUNCTION private.cupons_conferir();

UPDATE public.cupons c SET origem_id = o.id
  FROM public.config_options o
 WHERE c.origem_id IS NULL AND c.canal IS NOT NULL
   AND o.empresa_id = c.empresa_id AND o.kind = 'sales_origin'
   AND o.metadata->>'codigo' = lower(c.canal);
