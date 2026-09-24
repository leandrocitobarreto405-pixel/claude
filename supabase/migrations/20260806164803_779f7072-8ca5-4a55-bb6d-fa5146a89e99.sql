REVOKE UPDATE, DELETE ON public.expense_status_history FROM authenticated;
REVOKE ALL ON public.expense_status_history FROM anon;

CREATE POLICY esh_no_update ON public.expense_status_history AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);
CREATE POLICY esh_no_delete ON public.expense_status_history AS RESTRICTIVE FOR DELETE TO authenticated USING (false);