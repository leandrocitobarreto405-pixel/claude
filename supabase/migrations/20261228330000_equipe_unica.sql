-- Equipe única da Tatiana (31/10/2026): na empresa em que as atendentes se revezam, tarefas, acertos
-- e recado são da equipe (sem separar por pessoa). Quem marcou Feito/Pular/Resolvido fica gravado só
-- para o histórico do dono. Ligada na Turbine e na Ecoprime.
ALTER TABLE public.comercial_configuracoes
  ADD COLUMN IF NOT EXISTS equipe_unica boolean NOT NULL DEFAULT false;

-- Quem marcou a tarefa da Tatiana como feita ou pulada.
ALTER TABLE public.crm_followups ADD COLUMN IF NOT EXISTS concluida_por uuid;

-- A configuração só o admin lê pelo app; a regra abaixo precisa saber se a empresa é equipe única.
CREATE OR REPLACE FUNCTION private.equipe_unica(_empresa uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT equipe_unica FROM public.comercial_configuracoes WHERE empresa_id = _empresa), false);
$$;
REVOKE ALL ON FUNCTION private.equipe_unica(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.equipe_unica(uuid) TO authenticated, service_role;

-- Acerto da equipe (sem pessoa): qualquer pessoa da empresa vê e resolve.
DROP POLICY IF EXISTS comercial_cobrancas_select ON public.comercial_cobrancas;
CREATE POLICY comercial_cobrancas_select ON public.comercial_cobrancas FOR SELECT TO authenticated USING (
  (empresa_id = (SELECT private.empresa_ativa())
   AND ((SELECT private.tem_papel('admin'))
        OR user_id = (SELECT auth.uid())
        OR (user_id IS NULL AND (SELECT private.equipe_unica(private.empresa_ativa())))))
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
     AND (user_id = auth.uid() OR private.tem_papel('admin')
          OR (user_id IS NULL AND private.equipe_unica(emp)));
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobrança não encontrada.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.comercial_resolver_cobranca(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comercial_resolver_cobranca(uuid, text, text) TO authenticated;

-- Dados: Turbine e Ecoprime com equipe única (as atendentes se revezam).
UPDATE public.comercial_configuracoes SET equipe_unica = true
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', 'f1b06dbe-39dc-4344-89f7-dd27a68046d8');

SELECT private.instalar_travas_somente_leitura();
