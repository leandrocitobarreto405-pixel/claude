-- =====================================================================================
-- Nexa OS — Alice, fase 1 (do primeiro contato ao orçamento + follow-up dentro de 24 h)
--
--  * Controles por cliente (contato do WhatsApp): "IA desligada" (a Alice não responde, não faz
--    follow-up nem pós-venda) e "Sem pós-venda". Ligar "IA desligada" cancela o que estava agendado.
--  * Configuração: condições do orçamento (Pix, parcelas, validade), raio de atendimento, horário
--    permitido para mensagens ativas, agenda automática (fase 2), transcrição de áudio e as mídias
--    padrão (vídeo e áudio de cada serviço), guardadas no Storage na pasta da empresa.
--  * Follow-up: tarefa "followup" na fila da Alice, ligada a uma repescagem do CRM
--    (crm_followups.responsavel = 'alice'). Mensagem nova do cliente, atendente humano na conversa
--    ou IA desligada cancelam o follow-up pendente.
--  * whatsapp_messages.transcricao: texto dos áudios do cliente.
-- =====================================================================================

-- ---------------------------------------------------------------- controles por cliente
ALTER TABLE public.whatsapp_contacts
  ADD COLUMN ia_desligada boolean NOT NULL DEFAULT false,
  ADD COLUMN sem_pos_venda boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- configuração
ALTER TABLE public.ia_configuracoes
  DROP COLUMN desconto_max_percentual,
  ADD COLUMN desconto_pix_percentual numeric(5,2) NOT NULL DEFAULT 5
    CHECK (desconto_pix_percentual BETWEEN 0 AND 50),
  ADD COLUMN parcelas_max int NOT NULL DEFAULT 5 CHECK (parcelas_max BETWEEN 1 AND 12),
  ADD COLUMN validade_orcamento_dias int NOT NULL DEFAULT 2
    CHECK (validade_orcamento_dias BETWEEN 0 AND 30),
  ADD COLUMN raio_km numeric(6,1) CHECK (raio_km IS NULL OR raio_km > 0),
  ADD COLUMN hora_inicio int NOT NULL DEFAULT 8 CHECK (hora_inicio BETWEEN 0 AND 23),
  ADD COLUMN hora_fim int NOT NULL DEFAULT 21 CHECK (hora_fim BETWEEN 1 AND 24),
  ADD COLUMN agenda_automatica boolean NOT NULL DEFAULT false,
  ADD COLUMN transcrever_audio boolean NOT NULL DEFAULT true,
  ADD COLUMN video_higienizacao text,
  ADD COLUMN video_impermeabilizacao text,
  ADD COLUMN audio_higienizacao text,
  ADD COLUMN audio_impermeabilizacao text,
  ADD CONSTRAINT ia_configuracoes_horario CHECK (hora_inicio < hora_fim),
  -- O servidor baixa as mídias com a chave de serviço: só arquivos da pasta da própria empresa.
  ADD CONSTRAINT ia_configuracoes_midias_da_empresa CHECK (
    (video_higienizacao IS NULL OR video_higienizacao LIKE empresa_id::text || '/%')
    AND (video_impermeabilizacao IS NULL OR video_impermeabilizacao LIKE empresa_id::text || '/%')
    AND (audio_higienizacao IS NULL OR audio_higienizacao LIKE empresa_id::text || '/%')
    AND (audio_impermeabilizacao IS NULL OR audio_impermeabilizacao LIKE empresa_id::text || '/%'));

-- ---------------------------------------------------------------- follow-up na fila
ALTER TABLE public.ia_tarefas DROP CONSTRAINT ia_tarefas_tipo_check;
ALTER TABLE public.ia_tarefas
  ADD CONSTRAINT ia_tarefas_tipo_check CHECK (tipo IN ('responder', 'passar_para_humano', 'followup')),
  ADD COLUMN dados jsonb NOT NULL DEFAULT '{}';

ALTER TABLE public.crm_followups
  ADD COLUMN responsavel text NOT NULL DEFAULT 'equipe' CHECK (responsavel IN ('equipe', 'alice')),
  ADD COLUMN ia_tarefa_id uuid REFERENCES public.ia_tarefas(id) ON DELETE SET NULL;
CREATE INDEX idx_crm_followups_ia_tarefa ON public.crm_followups (ia_tarefa_id);
DROP TRIGGER trg_crm_followups_valida_empresa ON public.crm_followups;
CREATE TRIGGER trg_crm_followups_valida_empresa BEFORE INSERT OR UPDATE ON public.crm_followups
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias(
    'crm_lead_id', 'crm_leads', 'ia_tarefa_id', 'ia_tarefas');

ALTER TABLE public.whatsapp_messages ADD COLUMN transcricao text;

-- Cancela o follow-up pendente da Alice numa conversa (e a repescagem ligada a ele).
CREATE OR REPLACE FUNCTION private.ia_cancelar_followups(_conversa_id uuid, _motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_leads uuid[];
BEGIN
  WITH t AS (
    UPDATE public.ia_tarefas
       SET situacao = 'ignorada', motivo = _motivo, concluida_em = now()
     WHERE conversa_id = _conversa_id AND tipo = 'followup' AND situacao = 'pendente'
    RETURNING id
  ), f AS (
    UPDATE public.crm_followups
       SET status = 'Cancelada', completed_at = now(), result = _motivo
     WHERE ia_tarefa_id IN (SELECT id FROM t) AND status = 'Pendente'
    RETURNING crm_lead_id
  )
  SELECT array_agg(DISTINCT crm_lead_id) INTO v_leads FROM f;

  IF v_leads IS NOT NULL THEN
    UPDATE public.crm_leads l
       SET next_follow_up_at = (SELECT min(scheduled_at) FROM public.crm_followups
                                 WHERE crm_lead_id = l.id AND status = 'Pendente')
     WHERE l.id = ANY (v_leads);
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.ia_cancelar_followups(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- agendamento pelas mensagens
CREATE OR REPLACE FUNCTION private.ia_agendar_por_mensagem()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.ia_configuracoes;
  situacao_conversa text;
BEGIN
  IF NEW.conversa_id IS NULL OR NEW.privada THEN
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
  SELECT status INTO situacao_conversa FROM public.conversas WHERE id = NEW.conversa_id;
  IF situacao_conversa IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  IF NEW.direction = 'Recebida' THEN
    INSERT INTO public.ia_tarefas (empresa_id, conversa_id, tipo, executar_apos)
    VALUES (NEW.empresa_id, NEW.conversa_id, 'responder', now() + make_interval(secs => cfg.espera_segundos))
    ON CONFLICT (conversa_id, tipo) WHERE situacao = 'pendente'
    DO UPDATE SET executar_apos = EXCLUDED.executar_apos, enfileirada = false;
  ELSIF NEW.direction = 'Enviada' AND NEW.remetente_tipo = 'user' THEN
    -- Atendente humano escreveu: a Alice sai da conversa.
    UPDATE public.ia_tarefas
       SET situacao = 'ignorada', motivo = 'atendente humano assumiu', concluida_em = now()
     WHERE conversa_id = NEW.conversa_id AND tipo = 'responder' AND situacao = 'pendente';
    PERFORM private.ia_cancelar_followups(NEW.conversa_id, 'atendente humano assumiu');
    INSERT INTO public.ia_tarefas (empresa_id, conversa_id, tipo, motivo)
    VALUES (NEW.empresa_id, NEW.conversa_id, 'passar_para_humano', 'atendente humano escreveu na conversa')
    ON CONFLICT (conversa_id, tipo) WHERE situacao = 'pendente' DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

-- Conversa que saiu de "pendente" (humano assumiu no Chatwoot): cancela resposta e follow-up.
CREATE OR REPLACE FUNCTION private.ia_cancelar_fora_do_robo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' AND OLD.status = 'pending' THEN
    UPDATE public.ia_tarefas
       SET situacao = 'ignorada', motivo = 'conversa saiu do atendimento do robô', concluida_em = now()
     WHERE conversa_id = NEW.id AND tipo = 'responder' AND situacao = 'pendente';
    PERFORM private.ia_cancelar_followups(NEW.id, 'conversa saiu do atendimento do robô');
  END IF;
  RETURN NEW;
END $$;

-- "IA desligada" no cliente: nada do que estava agendado para ele é feito.
CREATE OR REPLACE FUNCTION private.ia_contato_desligado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c uuid;
BEGIN
  FOR c IN SELECT id FROM public.conversas WHERE whatsapp_contact_id = NEW.id LOOP
    UPDATE public.ia_tarefas
       SET situacao = 'ignorada', motivo = 'IA desligada para o cliente', concluida_em = now()
     WHERE conversa_id = c AND tipo = 'responder' AND situacao = 'pendente';
    PERFORM private.ia_cancelar_followups(c, 'IA desligada para o cliente');
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.ia_contato_desligado() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_whatsapp_contacts_ia_desligada AFTER UPDATE OF ia_desligada ON public.whatsapp_contacts
  FOR EACH ROW WHEN (NEW.ia_desligada AND NOT OLD.ia_desligada)
  EXECUTE FUNCTION private.ia_contato_desligado();

-- ---------------------------------------------------------------- mídias padrão da Alice
-- Pasta = id da empresa. Todos da empresa ouvem/veem; só o admin da empresa ativa troca os arquivos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('alice-midias', 'alice-midias', false, 16777216,
            ARRAY['video/mp4', 'video/3gpp', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr'])
    ON CONFLICT (id) DO NOTHING;

    EXECUTE $p$CREATE POLICY alice_midias_select ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'alice-midias'
             AND (storage.foldername(name))[1] IN (SELECT private.empresas_do_usuario((SELECT auth.uid()))::text))$p$;
    EXECUTE $p$CREATE POLICY alice_midias_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'alice-midias'
             AND (storage.foldername(name))[1] = (SELECT private.empresa_ativa())::text
             AND (SELECT private.tem_papel('admin')))$p$;
    EXECUTE $p$CREATE POLICY alice_midias_update ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'alice-midias'
             AND (storage.foldername(name))[1] = (SELECT private.empresa_ativa())::text
             AND (SELECT private.tem_papel('admin')))$p$;
    EXECUTE $p$CREATE POLICY alice_midias_delete ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'alice-midias'
             AND (storage.foldername(name))[1] = (SELECT private.empresa_ativa())::text
             AND (SELECT private.tem_papel('admin')))$p$;
  END IF;
END $$;
