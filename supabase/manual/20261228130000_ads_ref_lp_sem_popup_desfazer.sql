-- Desfaz 20261228130000_ads_ref_lp_sem_popup (pop-up das LPs ligado pelo código).
-- Tira os gatilhos e as funções; a ligação por telefone continua como antes.
-- As colunas novas (ads_clicks.ref_code, mensagens_origem.exige_popup, crm_leads.lp_sem_popup_em)
-- ficam: não apagam nada e o código só lê. Os cliques já ligados pelo código continuam ligados.
DROP TRIGGER IF EXISTS trg_whatsapp_messages_ads_lp ON public.whatsapp_messages;
DROP TRIGGER IF EXISTS trg_whatsapp_messages_ads_lp_lead ON public.whatsapp_messages;
DROP TRIGGER IF EXISTS trg_ads_clicks_ligado ON public.ads_clicks;
DROP FUNCTION IF EXISTS public.ads_definir_ref(uuid, text);
DROP FUNCTION IF EXISTS private.ads_mensagem_lp();
DROP FUNCTION IF EXISTS private.ads_clique_ligado();
DROP FUNCTION IF EXISTS private.ads_ligar_por_codigo(uuid, text, uuid);
DROP FUNCTION IF EXISTS private.ads_ref_da_mensagem(text);
UPDATE public.mensagens_origem SET exige_popup = false WHERE exige_popup;
-- Com o código desfeito, o servidor só registra no log a falha do ads_definir_ref (o clique já foi
-- gravado antes); para tirar também do código, reverter o commit do servidor.
