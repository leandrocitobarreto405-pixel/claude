-- Desfaz a migração 20261228340000_tatiana_ajustes (só com OK do usuário).
-- Os leads que ganharam customer_id e as cobranças 'cadastro' marcadas 'ja_certo' ficam como estão
-- (voltar exigiria apagar dados que estão certos); a lista volta a mostrar todas as pendentes.
DROP TRIGGER IF EXISTS trg_os_cliente_no_lead ON public.work_orders;
DROP FUNCTION IF EXISTS private.os_cliente_no_lead();
DROP TRIGGER IF EXISTS trg_lead_cliente_da_os ON public.crm_leads;
DROP FUNCTION IF EXISTS private.lead_cliente_da_os();
DROP POLICY IF EXISTS comercial_cobrancas_select ON public.comercial_cobrancas;
CREATE POLICY comercial_cobrancas_select ON public.comercial_cobrancas FOR SELECT TO authenticated USING (
  (empresa_id = (SELECT private.empresa_ativa())
   AND ((SELECT private.tem_papel('admin'))
        OR user_id = (SELECT auth.uid())
        OR (user_id IS NULL AND (SELECT private.equipe_unica(private.empresa_ativa())))))
  OR (SELECT private.is_nexa_admin()));
ALTER TABLE public.comercial_cobrancas DROP COLUMN IF EXISTS visivel_equipe;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228340000';
