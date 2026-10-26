-- Empresa de teste (ex.: "Teste Asaas (sandbox)"): fica fora do MRR, das contagens de assinaturas
-- e dos relatórios do Painel Nexa (comissão da Nexa, Alice). Começa falso em todas; quem marca é
-- a Nexa. Nenhum dado existente muda.
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS eh_teste boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.empresas.eh_teste IS 'Empresa de teste: fora do MRR e dos relatórios do Painel Nexa';

-- Só a Nexa (ou o servidor) marca e desmarca; o admin da empresa não tira a própria empresa do
-- MRR. Mesmo padrão da liberação da implantação (sem SECURITY DEFINER: current_user é quem fez o
-- UPDATE).
CREATE OR REPLACE FUNCTION private.empresas_proteger_teste()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.eh_teste IS DISTINCT FROM OLD.eh_teste
     AND current_user IN ('authenticated', 'anon') AND NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'Só a Nexa marca empresa de teste.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.empresas_proteger_teste() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_empresas_proteger_teste ON public.empresas;
CREATE TRIGGER trg_empresas_proteger_teste BEFORE UPDATE ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION private.empresas_proteger_teste();
