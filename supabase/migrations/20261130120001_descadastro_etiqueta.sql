-- Descadastro: o botão "Não quero mais ofertas" já pede a etiqueta "optout" (private.mkt_resposta).
-- O gatilho da frase escrita (20261130120000) só pede a etiqueta quando não é esse botão, para não
-- criar a tarefa duas vezes. O resto da função não muda.
CREATE OR REPLACE FUNCTION private.mkt_descadastro_mensagem()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w public.whatsapp_contacts;
  recente boolean;
BEGIN
  SELECT * INTO w FROM public.whatsapp_contacts
   WHERE id = NEW.whatsapp_contact_id AND empresa_id = NEW.empresa_id;
  IF w.id IS NULL OR w.marketing_optout_em IS NOT NULL THEN RETURN NEW; END IF;
  recente := (private.mkt_envio_recente(NEW.empresa_id, w.normalized_phone, 7)).id IS NOT NULL;
  IF NOT private.mkt_pedido_saida(NEW.text_content, recente) THEN RETURN NEW; END IF;

  UPDATE public.whatsapp_contacts
     SET marketing_optout_em = now(), marketing_optout_origem = 'cliente',
         marketing_optout_por = NULL, marketing_optout_confirmado_em = NULL
   WHERE id = w.id;
  -- Etiqueta "optout" no Chatwoot, como o botão já faz (só para quem está na base de marketing).
  -- Botão de opt-out de uma campanha recente: quem pede a etiqueta é private.mkt_resposta.
  IF recente AND (private.mkt_config(NEW.empresa_id)).botoes->>btrim(private.texto_busca(NEW.text_content)) = 'optout' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.mkt_tarefas (empresa_id, tipo, contato_id, conversa_id)
  SELECT NEW.empresa_id, 'etiqueta_optout', c.id, NEW.conversa_id
    FROM public.mkt_contatos c
   WHERE c.empresa_id = NEW.empresa_id
     AND private.telefone_chave(c.normalized_phone) = private.telefone_chave(w.normalized_phone)
   LIMIT 1;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.mkt_descadastro_mensagem() FROM PUBLIC, anon, authenticated;
