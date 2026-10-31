-- Desfaz 20261228330000_equipe_unica (só com OK): volta a política e a função de resolver acertos
-- ao texto de 20261228310000 e desliga a equipe única. As colunas podem ficar (o código anterior
-- ignora); a função private.equipe_unica fica sem uso.
UPDATE public.comercial_configuracoes SET equipe_unica = false;
DROP POLICY IF EXISTS comercial_cobrancas_select ON public.comercial_cobrancas;
CREATE POLICY comercial_cobrancas_select ON public.comercial_cobrancas FOR SELECT TO authenticated USING (
  (empresa_id = (SELECT private.empresa_ativa())
   AND ((SELECT private.tem_papel('admin')) OR user_id = (SELECT auth.uid())))
  OR (SELECT private.is_nexa_admin()));
CREATE OR REPLACE FUNCTION public.comercial_resolver_cobranca(_id uuid, _situacao text, _motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  emp uuid := private.empresa_ativa();
BEGIN
  IF emp IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501'; END IF;
  IF _situacao NOT IN ('resolvida', 'ja_certo', 'pendente') THEN RAISE EXCEPTION 'Situação inválida.'; END IF;
  UPDATE public.comercial_cobrancas
     SET situacao = _situacao,
         resolvida_em = CASE WHEN _situacao = 'pendente' THEN NULL ELSE now() END,
         resolvida_por = CASE WHEN _situacao = 'pendente' THEN NULL ELSE auth.uid() END,
         motivo = CASE WHEN _situacao = 'ja_certo' THEN left(nullif(btrim(_motivo), ''), 300) END
   WHERE id = _id AND empresa_id = emp
     AND (user_id = auth.uid() OR private.tem_papel('admin'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobrança não encontrada.'; END IF;
END $$;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228330000';
