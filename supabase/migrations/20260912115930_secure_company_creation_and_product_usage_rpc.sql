REVOKE ALL ON FUNCTION public.registrar_consumo_produto(uuid, uuid, uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_consumo_produto(uuid, uuid, uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_consumo_produto(uuid, uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_consumo_produto(uuid, uuid, uuid, numeric) TO service_role;

DROP POLICY IF EXISTS empresas_insert ON public.empresas;
REVOKE INSERT ON TABLE public.empresas FROM authenticated;
GRANT ALL ON TABLE public.empresas TO service_role;