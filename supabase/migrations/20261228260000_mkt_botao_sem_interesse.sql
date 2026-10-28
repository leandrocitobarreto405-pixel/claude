-- Botões do envio quinzenal "não recebeu orçamento" (tc_sem_orcamento, 28/10), todas as empresas:
-- 1) "Quero meu orçamento" = interesse (a Alice responde normalmente, pedindo foto e itens).
-- 2) "Não tenho interesse" = ação nova "sem_interesse": sai das próximas campanhas (como o
--    descadastro) e o lead em aberto vira perdido com o motivo "Não tem interesse" (criado na
--    empresa no primeiro uso). Lead já ganho, com OS ou já perdido não muda.
-- Os botões entram no mapa de cada empresa só se ainda não existirem (nada é trocado).

CREATE OR REPLACE FUNCTION private.mkt_lead_sem_interesse(_empresa uuid, _lead uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  motivo uuid;
  perdido uuid;
  l public.crm_leads;
  conversa uuid;
BEGIN
  IF _lead IS NULL THEN RETURN; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id = _lead AND empresa_id = _empresa FOR UPDATE;
  IF l.id IS NULL OR l.perdido_em IS NOT NULL OR l.realizado_em IS NOT NULL
     OR l.os_criada_em IS NOT NULL OR l.linked_work_order_id IS NOT NULL THEN
    RETURN;
  END IF;
  SELECT o.id INTO motivo FROM public.config_options o
   WHERE o.empresa_id = _empresa AND o.kind = 'crm_loss_reason' AND o.name = 'Não tem interesse'
   ORDER BY o.active DESC LIMIT 1;
  IF motivo IS NULL THEN
    INSERT INTO public.config_options (empresa_id, kind, name, display_order)
    SELECT _empresa, 'crm_loss_reason', 'Não tem interesse',
           coalesce(max(display_order), 0) + 1
      FROM public.config_options WHERE empresa_id = _empresa AND kind = 'crm_loss_reason'
    RETURNING id INTO motivo;
  END IF;
  SELECT o.id INTO perdido FROM public.config_options o
   WHERE o.empresa_id = _empresa AND o.kind = 'crm_status' AND o.active
     AND (o.metadata->>'lost')::boolean IS TRUE
   ORDER BY o.display_order LIMIT 1;
  UPDATE public.crm_leads
     SET loss_reason_id = motivo,
         status_id = coalesce(perdido, status_id),
         perdido_em = now(),
         is_open = false,
         closed_at = coalesce(closed_at, now()),
         next_follow_up_at = NULL,
         desfecho_obs = 'Respondeu "Não tenho interesse" no envio de marketing.',
         desfecho_em = now()
   WHERE id = l.id;
  SELECT c.id INTO conversa FROM public.conversas c WHERE c.crm_lead_id = l.id
   ORDER BY c.ultima_atividade_em DESC NULLS LAST LIMIT 1;
  IF conversa IS NOT NULL THEN
    PERFORM private.ia_cancelar_followups(conversa, 'marketing: não tem interesse');
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.mkt_lead_sem_interesse(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Resposta à campanha: "sem_interesse" faz o mesmo que o descadastro e marca o lead como perdido.
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

  IF acao IN ('optout', 'sem_interesse') THEN
    UPDATE public.mkt_contatos SET optout_em = coalesce(optout_em, now()) WHERE id = e.contato_id;
    UPDATE public.mkt_envios SET status = 'cancelado', erro = 'opt-out'
     WHERE contato_id = e.contato_id AND status IN ('pendente', 'manual');
    INSERT INTO public.mkt_tarefas (empresa_id, tipo, contato_id, conversa_id)
    VALUES (NEW.empresa_id, 'etiqueta_optout', e.contato_id, NEW.conversa_id);
    PERFORM private.mkt_checar_lote(e.lote_id);
    -- "Não tenho interesse": além de sair das campanhas, o lead em aberto vira perdido.
    IF acao = 'sem_interesse' THEN
      PERFORM private.mkt_lead_sem_interesse(NEW.empresa_id, coalesce(NEW.crm_lead_id, e.crm_lead_id));
    END IF;
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
  IF k.quem_responde = 'equipe' AND coalesce(acao, '') NOT IN ('optout', 'sem_interesse', 'problema')
     AND NEW.conversa_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.conversas cv WHERE cv.id = NEW.conversa_id AND cv.status = 'pending') THEN
    PERFORM private.ia_tirar_alice(NEW, 'resposta de campanha atendida pela equipe',
      format('📣 Resposta da campanha "%s", que é atendida pela equipe: a Alice não vai responder. Atenda por aqui.',
             k.nome));
  END IF;
  RETURN NEW;
END $$;


-- Os dois botões no mapa (empresas que já existem e padrão das novas), sem trocar o que existe.
UPDATE public.mkt_configuracoes
   SET botoes = '{"quero meu orcamento": "interesse", "nao tenho interesse": "sem_interesse"}'::jsonb || botoes
 WHERE NOT (botoes ? 'quero meu orcamento' AND botoes ? 'nao tenho interesse');
ALTER TABLE public.mkt_configuracoes ALTER COLUMN botoes
  SET DEFAULT '{"agora nao": "recusou", "ja resolvi": "recusou", "ficou otimo": "elogio", "quero o valor": "interesse", "quero renovar": "interesse", "quero reservar": "interesse", "quero orcamento": "interesse", "quero aproveitar": "interesse", "tive um problema": "problema", "me mostre as datas": "interesse", "quero um orcamento": "interesse", "quero ver as datas": "interesse", "quero ver horarios": "interesse", "nao quero mais ofertas": "optout", "quero meu orcamento": "interesse", "nao tenho interesse": "sem_interesse"}'::jsonb;
