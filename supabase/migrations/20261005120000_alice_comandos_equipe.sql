-- Alice: a equipe tira e devolve a Alice de uma conversa com um comando, e cliente antigo vai direto
-- para a equipe.
--
--  * Comandos (nota privada no Chatwoot, começando com # ou /):
--      #parar     a Alice sai desta conversa (fica com a equipe);
--      #desligar  IA desligada para o cliente (nem respostas, nem follow-up, nem pós-venda);
--      #alice     devolve a conversa para a Alice (e religa a IA do cliente, se estava desligada).
--    Mensagem normal da equipe (inclusive a digitada no WhatsApp Business do celular, que chega ao
--    Chatwoot como "eco") continua tirando a Alice da conversa, como antes.
--  * Cliente antigo (cadastrado em Clientes ou com serviço feito): a Alice não responde e a conversa
--    vai para a equipe, a menos que a equipe devolva a conversa para ela (#alice ou botão do lead).
--    Liga/desliga em ia_configuracoes.clientes_antigos_com_equipe.

ALTER TABLE public.ia_configuracoes
  ADD COLUMN clientes_antigos_com_equipe boolean NOT NULL DEFAULT true;

ALTER TABLE public.conversas
  ADD COLUMN devolvida_para_alice_em timestamptz;

ALTER TABLE public.ia_tarefas DROP CONSTRAINT ia_tarefas_tipo_check;
ALTER TABLE public.ia_tarefas ADD CONSTRAINT ia_tarefas_tipo_check
  CHECK (tipo IN ('responder', 'passar_para_humano', 'followup', 'enviar_mensagens', 'devolver_para_alice'));

-- Comando da equipe no começo do texto: 'parar', 'desligar', 'alice' ou NULL.
CREATE OR REPLACE FUNCTION private.ia_comando_da_equipe(_texto text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN c ~ '^[#/](parar|pare|humano|equipe)$' THEN 'parar'
    WHEN c ~ '^[#/](desligar|desliga)$' THEN 'desligar'
    WHEN c ~ '^[#/](alice|voltar)$' THEN 'alice'
  END
  FROM (SELECT lower(substring(btrim(coalesce(_texto, '')) FROM '^\S+')) AS c) x;
$$;
REVOKE ALL ON FUNCTION private.ia_comando_da_equipe(text) FROM PUBLIC, anon, authenticated;

-- Cliente antigo: cadastrado em Clientes ou com serviço feito num lead.
CREATE OR REPLACE FUNCTION private.ia_cliente_antigo(_contato uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
      SELECT 1 FROM public.whatsapp_contacts
       WHERE id = _contato AND (is_existing_customer OR current_customer_id IS NOT NULL))
    OR EXISTS (
      SELECT 1 FROM public.crm_leads
       WHERE whatsapp_contact_id = _contato
         AND (customer_id IS NOT NULL OR realizado_em IS NOT NULL OR linked_work_order_id IS NOT NULL));
$$;
REVOKE ALL ON FUNCTION private.ia_cliente_antigo(uuid) FROM PUBLIC, anon, authenticated;

-- Tira a Alice da conversa: cancela o que ela ia fazer e agenda a passagem para a equipe.
CREATE OR REPLACE FUNCTION private.ia_tirar_alice(_msg public.whatsapp_messages, _motivo text, _nota text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.ia_tarefas
     SET situacao = 'ignorada', motivo = _motivo, concluida_em = now()
   WHERE conversa_id = _msg.conversa_id AND situacao = 'pendente'
     AND tipo IN ('responder', 'enviar_mensagens', 'devolver_para_alice');
  PERFORM private.ia_cancelar_followups(_msg.conversa_id, _motivo);
  INSERT INTO public.ia_tarefas AS t (empresa_id, conversa_id, tipo, motivo, dados)
  VALUES (_msg.empresa_id, _msg.conversa_id, 'passar_para_humano', _motivo,
          CASE WHEN _nota IS NOT NULL THEN jsonb_build_object('nota', _nota) ELSE '{}'::jsonb END)
  ON CONFLICT (conversa_id, tipo) WHERE situacao = 'pendente'
  DO UPDATE SET dados = CASE WHEN _nota IS NOT NULL THEN EXCLUDED.dados ELSE t.dados END;
END $$;
REVOKE ALL ON FUNCTION private.ia_tirar_alice(public.whatsapp_messages, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.ia_executar_comando(_msg public.whatsapp_messages, _comando text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _comando = 'parar' THEN
    PERFORM private.ia_tirar_alice(_msg, 'equipe mandou #parar',
      '🤖 Ok! A Alice saiu desta conversa e não responde mais aqui. Para devolver, mande a nota #alice.');
  ELSIF _comando = 'desligar' THEN
    UPDATE public.whatsapp_contacts SET ia_desligada = true
     WHERE id = _msg.whatsapp_contact_id AND NOT ia_desligada;
    PERFORM private.ia_tirar_alice(_msg, 'equipe mandou #desligar',
      '🤖 Ok! IA desligada para este cliente: a Alice não fala mais com ele (nem follow-up, nem pós-venda). Para religar, mande a nota #alice.');
  ELSIF _comando = 'alice' THEN
    UPDATE public.whatsapp_contacts SET ia_desligada = false
     WHERE id = _msg.whatsapp_contact_id AND ia_desligada;
    UPDATE public.conversas SET devolvida_para_alice_em = now() WHERE id = _msg.conversa_id;
    UPDATE public.ia_tarefas
       SET situacao = 'ignorada', motivo = 'equipe mandou #alice', concluida_em = now()
     WHERE conversa_id = _msg.conversa_id AND situacao = 'pendente' AND tipo = 'passar_para_humano';
    INSERT INTO public.ia_tarefas (empresa_id, conversa_id, tipo, motivo)
    VALUES (_msg.empresa_id, _msg.conversa_id, 'devolver_para_alice', 'equipe mandou #alice')
    ON CONFLICT (conversa_id, tipo) WHERE situacao = 'pendente' DO NOTHING;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.ia_executar_comando(public.whatsapp_messages, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.ia_agendar_por_mensagem()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.ia_configuracoes;
  conversa public.conversas;
  comando text;
BEGIN
  IF NEW.conversa_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Comando da equipe (nota privada ou mensagem): vale mesmo com a Alice desligada na empresa,
  -- para a equipe ter a confirmação e o #desligar ficar gravado no cliente.
  IF NEW.direction = 'Enviada' AND NEW.remetente_tipo = 'user' THEN
    comando := private.ia_comando_da_equipe(NEW.text_content);
    IF comando IS NOT NULL THEN
      PERFORM private.ia_executar_comando(NEW, comando);
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.privada THEN
    RETURN NEW;
  END IF;
  -- Cliente respondeu: o follow-up agendado perde o sentido (a resposta nova cuida da conversa).
  IF NEW.direction = 'Recebida' THEN
    PERFORM private.ia_cancelar_followups(NEW.conversa_id, 'cliente respondeu');
  END IF;

  SELECT * INTO cfg FROM public.ia_configuracoes WHERE empresa_id = NEW.empresa_id AND ativo;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_contacts WHERE id = NEW.whatsapp_contact_id AND ia_desligada) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO conversa FROM public.conversas WHERE id = NEW.conversa_id;
  IF conversa.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  IF NEW.direction = 'Recebida' THEN
    IF cfg.clientes_antigos_com_equipe AND conversa.devolvida_para_alice_em IS NULL
       AND private.ia_cliente_antigo(NEW.whatsapp_contact_id) THEN
      PERFORM private.ia_tirar_alice(NEW, 'cliente antigo: fica com a equipe',
        '🤖 Cliente antigo (já tem cadastro ou serviço feito): a Alice não respondeu e deixou a conversa com a equipe. Se quiser que ela atenda, mande a nota #alice.');
      RETURN NEW;
    END IF;
    INSERT INTO public.ia_tarefas (empresa_id, conversa_id, tipo, executar_apos)
    VALUES (NEW.empresa_id, NEW.conversa_id, 'responder', now() + make_interval(secs => cfg.espera_segundos))
    ON CONFLICT (conversa_id, tipo) WHERE situacao = 'pendente'
    DO UPDATE SET executar_apos = EXCLUDED.executar_apos, enfileirada = false;
  ELSIF NEW.direction = 'Enviada' AND NEW.remetente_tipo = 'user' THEN
    -- Atendente humano escreveu (no Chatwoot ou no WhatsApp do celular): a Alice sai da conversa.
    PERFORM private.ia_tirar_alice(NEW, 'atendente humano assumiu', NULL);
  END IF;
  RETURN NEW;
END $$;
