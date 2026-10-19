-- Criar lead pela tela do CRM (usuário logado) dava "permission denied for function
-- telefone_chave": o índice idx_crm_leads_telefone_chave (e os de mkt_contatos, indicacoes,
-- leads_site e ads_clicks) calcula essa função com as permissões de quem grava. Ela só devolve
-- DDD + últimos 8 dígitos do telefone. Só EXECUTE nesta função; nada mais muda.
GRANT EXECUTE ON FUNCTION private.telefone_chave(text) TO authenticated;
