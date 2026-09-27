-- Ajustes apontados pelo Security/Performance Advisor do Supabase na integração Chatwoot.

-- search_path fixo nas funções utilitárias (só usam funções do pg_catalog).
ALTER FUNCTION private.normalizar_telefone(text) SET search_path = '';
ALTER FUNCTION private.chatwoot_data(jsonb) SET search_path = '';
ALTER FUNCTION private.chatwoot_chave_dedup(jsonb) SET search_path = '';

-- Segredos: nenhum acesso pelo app (a chave de serviço ignora RLS). Política explícita.
CREATE POLICY chatwoot_conexao_segredos_sem_acesso ON public.chatwoot_conexao_segredos
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Uma política por ação (evita avaliar duas políticas permissivas em cada SELECT).
DROP POLICY chatwoot_inboxes_nexa ON public.chatwoot_inboxes;
DROP POLICY chatwoot_inboxes_empresa_select ON public.chatwoot_inboxes;
CREATE POLICY chatwoot_inboxes_select ON public.chatwoot_inboxes FOR SELECT TO authenticated
  USING ((SELECT private.is_nexa_admin()) OR empresa_id = (SELECT private.empresa_ativa()));
CREATE POLICY chatwoot_inboxes_insert ON public.chatwoot_inboxes FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_nexa_admin()));
CREATE POLICY chatwoot_inboxes_update ON public.chatwoot_inboxes FOR UPDATE TO authenticated
  USING ((SELECT private.is_nexa_admin())) WITH CHECK ((SELECT private.is_nexa_admin()));
CREATE POLICY chatwoot_inboxes_delete ON public.chatwoot_inboxes FOR DELETE TO authenticated
  USING ((SELECT private.is_nexa_admin()));

DROP POLICY integracao_eventos_nexa ON public.integracao_eventos;
DROP POLICY integracao_eventos_empresa ON public.integracao_eventos;
CREATE POLICY integracao_eventos_select ON public.integracao_eventos FOR SELECT TO authenticated
  USING ((SELECT private.is_nexa_admin()) OR empresa_id = (SELECT private.empresa_ativa()));

CREATE INDEX idx_integracao_eventos_conexao ON public.integracao_eventos (conexao_id);
