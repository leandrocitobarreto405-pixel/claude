-- Numeração de OS por empresa: Painel Nexa › Empresas ganha "próximo número de OS".
-- A próxima OS recebe o maior entre (maior número já usado + 1) e esse campo. O campo só
-- pode aumentar e nunca fica abaixo do maior número já usado (gatilho). Só acréscimos.
-- Para voltar: tirar a coluna, a função e o gatilho; a numeração segue pelo maior usado + 1.

ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS proximo_numero_os integer;

CREATE OR REPLACE FUNCTION private.maior_numero_os(_empresa_id uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max(nullif(regexp_replace(os_number, '\D', '', 'g'), '')::bigint)
    FROM public.work_orders WHERE empresa_id = _empresa_id;
$$;
REVOKE ALL ON FUNCTION private.maior_numero_os(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.validar_proximo_numero_os()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  maior bigint;
BEGIN
  IF NEW.proximo_numero_os IS NOT DISTINCT FROM OLD.proximo_numero_os THEN
    RETURN NEW;
  END IF;
  IF NEW.proximo_numero_os IS NULL THEN
    RAISE EXCEPTION 'O próximo número de OS não pode ser apagado.';
  END IF;
  IF NEW.proximo_numero_os < 1 OR NEW.proximo_numero_os > 999999 THEN
    RAISE EXCEPTION 'O próximo número de OS deve ficar entre 1 e 999999.';
  END IF;
  IF OLD.proximo_numero_os IS NOT NULL AND NEW.proximo_numero_os < OLD.proximo_numero_os THEN
    RAISE EXCEPTION 'O próximo número de OS só pode aumentar (hoje é %).', OLD.proximo_numero_os;
  END IF;
  maior := private.maior_numero_os(NEW.id);
  IF maior IS NOT NULL AND NEW.proximo_numero_os <= maior THEN
    RAISE EXCEPTION 'O próximo número de OS precisa ser maior que o maior número já usado (%).', maior;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validar_proximo_numero_os ON public.empresas;
CREATE TRIGGER validar_proximo_numero_os
  BEFORE UPDATE OF proximo_numero_os ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION private.validar_proximo_numero_os();

-- Próximo número da OS da empresa, com 4 dígitos (ex.: "1500"). Quem chama precisa enxergar a
-- empresa (RLS de quem chama; o servidor da Alice usa a conta de serviço).
CREATE OR REPLACE FUNCTION public.proximo_numero_os(_empresa_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT lpad(
    greatest(
      coalesce((SELECT max(nullif(regexp_replace(os_number, '\D', '', 'g'), '')::bigint) + 1
                  FROM public.work_orders WHERE empresa_id = _empresa_id), 1),
      coalesce((SELECT proximo_numero_os FROM public.empresas WHERE id = _empresa_id), 1)
    )::text, 4, '0');
$$;
REVOKE ALL ON FUNCTION public.proximo_numero_os(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proximo_numero_os(uuid) TO authenticated, service_role;

-- Ecoprime: a próxima OS começa em 1500 (pedido de 21/10/2026). A Turbine não muda.
UPDATE public.empresas SET proximo_numero_os = 1500
 WHERE id = 'f1b06dbe-39dc-4344-89f7-dd27a68046d8' AND proximo_numero_os IS NULL;
