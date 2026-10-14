-- Repaginada, fase 1: permissões no servidor (RLS), não só na tela.
--
-- 1. Despesas (expenses, recurring_expenses, technician_expenses): só o admin lê e grava.
--    A atendente não vê despesas nem lucro; o técnico nunca viu. O robô (service_role) não passa
--    pelo RLS: rotas, fechamento mensal e despesas recorrentes continuam iguais. Concluir serviço
--    (atendente/técnico) gera rota e rateio, não despesa, então nada quebra.
-- 2. Serviços (visits, budget_visits): o técnico só enxerga os do técnico ligado ao login dele
--    (technicians.user_id). Admin e atendente continuam vendo tudo. Técnico sem cadastro ligado
--    não vê nenhum serviço.
-- Nada é apagado; só as políticas mudam.

CREATE OR REPLACE FUNCTION private.meu_tecnico_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id FROM public.technicians t
   WHERE t.user_id = auth.uid() AND t.empresa_id = private.empresa_ativa()
   ORDER BY t.active DESC, t.display_order
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.meu_tecnico_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.meu_tecnico_id() TO authenticated, service_role;

-- 1. Despesas: só admin (ou a Nexa, que entra como admin).
ALTER POLICY expenses_empresa_ativa ON public.expenses
  USING (empresa_id = (SELECT private.empresa_ativa())
         AND (SELECT private.meu_papel()) = 'admin'::public.papel_empresa)
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa())
         AND (SELECT private.meu_papel()) = 'admin'::public.papel_empresa);
ALTER POLICY recurring_expenses_empresa_ativa ON public.recurring_expenses
  USING (empresa_id = (SELECT private.empresa_ativa())
         AND (SELECT private.meu_papel()) = 'admin'::public.papel_empresa)
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa())
         AND (SELECT private.meu_papel()) = 'admin'::public.papel_empresa);
ALTER POLICY technician_expenses_empresa_ativa ON public.technician_expenses
  USING (empresa_id = (SELECT private.empresa_ativa())
         AND (SELECT private.meu_papel()) = 'admin'::public.papel_empresa)
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa())
         AND (SELECT private.meu_papel()) = 'admin'::public.papel_empresa);

-- 2. Serviços: técnico só os dele.
ALTER POLICY visits_empresa_ativa ON public.visits
  USING (empresa_id = (SELECT private.empresa_ativa())
         AND ((SELECT private.meu_papel()) IS DISTINCT FROM 'tecnico'::public.papel_empresa
              OR technician_id = (SELECT private.meu_tecnico_id())))
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa())
         AND ((SELECT private.meu_papel()) IS DISTINCT FROM 'tecnico'::public.papel_empresa
              OR technician_id = (SELECT private.meu_tecnico_id())));
ALTER POLICY budget_visits_empresa_ativa ON public.budget_visits
  USING (empresa_id = (SELECT private.empresa_ativa())
         AND ((SELECT private.meu_papel()) IS DISTINCT FROM 'tecnico'::public.papel_empresa
              OR technician_id = (SELECT private.meu_tecnico_id())))
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa())
         AND ((SELECT private.meu_papel()) IS DISTINCT FROM 'tecnico'::public.papel_empresa
              OR technician_id = (SELECT private.meu_tecnico_id())));
