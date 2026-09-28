-- =====================================================================================
-- Nexa OS — link da conversa sem SECURITY DEFINER exposto na API
--
-- public.url_chatwoot(conversas) era SECURITY DEFINER e podia ser chamada por
-- /rest/v1/rpc/url_chatwoot com uma linha montada à mão (conexão de outra empresa). Agora a
-- função pública roda com as permissões de quem chama: só gera o link de conversas que a RLS
-- deixa ver; a leitura do endereço/conta do Chatwoot fica numa função privada.
-- =====================================================================================

CREATE OR REPLACE FUNCTION private.url_conversa_chatwoot(_conversa_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rtrim(c.base_url, '/') || '/app/accounts/' || c.account_id || '/conversations/'
         || v.chatwoot_conversation_id
    FROM public.conversas v JOIN public.chatwoot_conexoes c ON c.id = v.conexao_id
   WHERE v.id = _conversa_id;
$$;
REVOKE ALL ON FUNCTION private.url_conversa_chatwoot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.url_conversa_chatwoot(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.url_chatwoot(public.conversas)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT private.url_conversa_chatwoot(v.id) FROM public.conversas v WHERE v.id = $1.id;
$$;
REVOKE ALL ON FUNCTION public.url_chatwoot(public.conversas) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.url_chatwoot(public.conversas) TO authenticated, service_role;
