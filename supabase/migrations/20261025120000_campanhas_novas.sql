-- Campanhas criadas pelo app (Marketing → Nova campanha).
-- 1. mkt_campanhas.quem_responde: 'alice' (padrão, como sempre foi) ou 'equipe'. O admin escolhe ao
--    criar e pode trocar a qualquer momento; vale para as próximas respostas.
-- 2. mkt_campanhas.criada_por: quem criou a campanha pelo app (vazio nas do calendário).
-- 3. Respostas: campanha "equipe" tira a Alice da conversa e deixa uma nota interna para a equipe.
--    Igual à função de 20261008120000, mais o bloco do fim.

ALTER TABLE public.mkt_campanhas
  ADD COLUMN IF NOT EXISTS quem_responde text NOT NULL DEFAULT 'alice'
    CHECK (quem_responde IN ('alice', 'equipe')),
  ADD COLUMN IF NOT EXISTS criada_por uuid REFERENCES auth.users(id);

CREATE OR REPLACE FUNCTION private.mkt_resposta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fone text;
  e public.mkt_envios;
  cfg public.mkt_configuracoes;
  botao text;
  acao text;
  primeira boolean;
  k public.mkt_campanhas;
BEGIN
  SELECT normalized_phone INTO fone FROM public.whatsapp_contacts WHERE id = NEW.whatsapp_contact_id;
  e := private.mkt_envio_recente(NEW.empresa_id, fone, 7);
  IF e.id IS NULL THEN RETURN NEW; END IF;
  cfg := private.mkt_config(NEW.empresa_id);
  botao := btrim(private.texto_busca(NEW.text_content));
  acao := cfg.botoes->>botao;
  primeira := e.respondido_em IS NULL;
  SELECT * INTO k FROM public.mkt_campanhas WHERE id = e.campanha_id;

  UPDATE public.mkt_envios
     SET respondido_em = coalesce(respondido_em, coalesce(NEW.message_timestamp, now())),
         botao_clicado = coalesce(botao_clicado, CASE WHEN acao IS NOT NULL THEN botao END),
         crm_lead_id = coalesce(crm_lead_id, NEW.crm_lead_id)
   WHERE id = e.id;
  IF NEW.crm_lead_id IS NOT NULL THEN
    UPDATE public.crm_leads
       SET sales_origin_id = coalesce(sales_origin_id, private.mkt_origem_campanha(NEW.empresa_id)),
           campaign_id = coalesce(campaign_id, k.crm_campaign_id)
     WHERE id = NEW.crm_lead_id;
    UPDATE public.mkt_contatos SET crm_lead_id = NEW.crm_lead_id WHERE id = e.contato_id AND crm_lead_id IS NULL;
  END IF;
  IF primeira OR acao IS NOT NULL THEN
    PERFORM private.mkt_log(NEW.empresa_id, 'resposta', coalesce(acao, 'texto'),
      jsonb_build_object('botao', CASE WHEN acao IS NOT NULL THEN botao END, 'mensagem_id', NEW.id),
      e.campanha_id, e.lote_id, e.id, e.contato_id);
  END IF;

  IF acao = 'optout' THEN
    UPDATE public.mkt_contatos SET optout_em = coalesce(optout_em, now()) WHERE id = e.contato_id;
    UPDATE public.mkt_envios SET status = 'cancelado', erro = 'opt-out'
     WHERE contato_id = e.contato_id AND status IN ('pendente', 'manual');
    INSERT INTO public.mkt_tarefas (empresa_id, tipo, contato_id, conversa_id)
    VALUES (NEW.empresa_id, 'etiqueta_optout', e.contato_id, NEW.conversa_id);
    PERFORM private.mkt_checar_lote(e.lote_id);
  ELSIF acao = 'recusou' THEN
    UPDATE public.mkt_contatos SET recusou_grupo = e.grupo, recusou_em = now() WHERE id = e.contato_id;
    UPDATE public.mkt_envios SET status = 'cancelado', erro = 'recusou neste ciclo'
     WHERE contato_id = e.contato_id AND grupo IS NOT DISTINCT FROM e.grupo AND status IN ('pendente', 'manual');
  ELSIF acao = 'problema' THEN
    UPDATE public.mkt_contatos SET sem_pos_venda = true WHERE id = e.contato_id;
    UPDATE public.whatsapp_contacts SET sem_pos_venda = true WHERE id = NEW.whatsapp_contact_id;
    IF NEW.conversa_id IS NOT NULL THEN
      PERFORM private.ia_tirar_alice(NEW, 'cliente relatou problema no pós-venda',
        '⚠️ PRIORIDADE: o cliente apertou "Tive um problema" no pós-venda. A Alice saiu da conversa; atenda o quanto antes.');
      INSERT INTO public.mkt_tarefas (empresa_id, tipo, contato_id, conversa_id)
      VALUES (NEW.empresa_id, 'prioridade_urgente', e.contato_id, NEW.conversa_id);
    END IF;
    PERFORM private.mkt_avisar(NEW.empresa_id, 'problema_pos_venda', 'Cliente com problema no pós-venda',
      format('%s respondeu "Tive um problema" ao pós-venda. A conversa foi para a equipe com prioridade.',
             coalesce((SELECT nome FROM public.mkt_contatos WHERE id = e.contato_id), e.normalized_phone)),
      e.campanha_id, e.lote_id);
  END IF;

  -- Campanha atendida pela equipe: a Alice não responde (vale para as próximas respostas, inclusive
  -- se o admin trocar com a campanha em andamento). Só enquanto a conversa está com a Alice
  -- (pendente); quem pediu para sair não vai para a equipe. A nota é interna: nada vai ao cliente.
  IF k.quem_responde = 'equipe' AND coalesce(acao, '') NOT IN ('optout', 'problema')
     AND NEW.conversa_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.conversas cv WHERE cv.id = NEW.conversa_id AND cv.status = 'pending') THEN
    PERFORM private.ia_tirar_alice(NEW, 'resposta de campanha atendida pela equipe',
      format('📣 Resposta da campanha "%s", que é atendida pela equipe: a Alice não vai responder. Atenda por aqui.',
             k.nome));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.mkt_resposta() FROM PUBLIC, anon, authenticated;
