-- =====================================================================================
-- Nexa OS — Alice, a vendedora de IA no Chatwoot
--
-- Fluxo: com o robô "Alice" ligado na caixa de entrada do Chatwoot, as conversas novas nascem
-- "pendentes" (atendidas pelo robô). Cada mensagem do cliente numa conversa pendente de uma
-- empresa com a Alice ligada agenda uma tarefa "responder" — com espera de alguns segundos, para
-- juntar mensagens seguidas numa resposta só. Se um atendente humano escreve na conversa, a tarefa
-- pendente é cancelada e a conversa passa para "aberta" (atendimento humano).
--
--  * ia_configuracoes: liga/desliga e instruções da Alice por empresa (admin da empresa edita).
--  * ia_tarefas: fila (o servidor processa; a empresa só lê).
--  * ia_execucoes: cada resposta da IA, com tokens e custo estimado (a empresa só lê).
--  * salespeople.eh_ia: a Alice aparece como vendedora ("vendido por" Alice × Carol × Maria).
--  * Chatwoot: id e token do robô (o token fica só na tabela de segredos).
-- =====================================================================================

-- ---------------------------------------------------------------- configuração por empresa
CREATE TABLE public.ia_configuracoes (
  empresa_id uuid PRIMARY KEY DEFAULT private.empresa_ativa() REFERENCES public.empresas(id) ON DELETE CASCADE,
  ativo boolean NOT NULL DEFAULT false,
  nome text NOT NULL DEFAULT 'Alice' CHECK (length(trim(nome)) BETWEEN 1 AND 40),
  instrucoes text NOT NULL DEFAULT '',
  perguntas_frequentes text NOT NULL DEFAULT '',
  desconto_max_percentual numeric(5,2) NOT NULL DEFAULT 0 CHECK (desconto_max_percentual BETWEEN 0 AND 100),
  modelo text NOT NULL DEFAULT 'claude-opus-5',
  esforco text NOT NULL DEFAULT 'medium' CHECK (esforco IN ('low', 'medium', 'high')),
  espera_segundos int NOT NULL DEFAULT 8 CHECK (espera_segundos BETWEEN 0 AND 120),
  limite_respostas_conversa int NOT NULL DEFAULT 40 CHECK (limite_respostas_conversa BETWEEN 1 AND 500),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ia_configuracoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ia_configuracoes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ia_configuracoes TO authenticated;
GRANT ALL ON public.ia_configuracoes TO service_role;
CREATE POLICY ia_configuracoes_select ON public.ia_configuracoes FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));
CREATE POLICY ia_configuracoes_insert ON public.ia_configuracoes FOR INSERT TO authenticated
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
CREATE POLICY ia_configuracoes_update ON public.ia_configuracoes FOR UPDATE TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')))
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
CREATE TRIGGER trg_ia_configuracoes_upd BEFORE UPDATE ON public.ia_configuracoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------- fila
CREATE TABLE public.ia_tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conversa_id uuid NOT NULL REFERENCES public.conversas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('responder', 'passar_para_humano')),
  situacao text NOT NULL DEFAULT 'pendente'
    CHECK (situacao IN ('pendente', 'processando', 'concluida', 'ignorada', 'erro')),
  executar_apos timestamptz NOT NULL DEFAULT now(),
  enfileirada boolean NOT NULL DEFAULT false,
  tentativas int NOT NULL DEFAULT 0,
  motivo text,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  iniciada_em timestamptz,
  concluida_em timestamptz
);
-- Uma tarefa pendente de cada tipo por conversa (mensagens seguidas só adiam a mesma tarefa).
CREATE UNIQUE INDEX ia_tarefas_pendente_key ON public.ia_tarefas (conversa_id, tipo) WHERE situacao = 'pendente';
CREATE INDEX idx_ia_tarefas_fila ON public.ia_tarefas (executar_apos) WHERE situacao = 'pendente';
CREATE INDEX idx_ia_tarefas_empresa ON public.ia_tarefas (empresa_id, created_at DESC);
ALTER TABLE public.ia_tarefas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ia_tarefas FROM anon, authenticated;
GRANT SELECT ON public.ia_tarefas TO authenticated;
GRANT ALL ON public.ia_tarefas TO service_role;
CREATE POLICY ia_tarefas_select ON public.ia_tarefas FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));
CREATE TRIGGER trg_ia_tarefas_valida_empresa BEFORE INSERT OR UPDATE ON public.ia_tarefas
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias('conversa_id', 'conversas');

-- ---------------------------------------------------------------- execuções (custo e auditoria)
CREATE TABLE public.ia_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conversa_id uuid REFERENCES public.conversas(id) ON DELETE SET NULL,
  tarefa_id uuid REFERENCES public.ia_tarefas(id) ON DELETE SET NULL,
  crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  modelo text NOT NULL,
  rodadas int NOT NULL DEFAULT 0,
  tokens_entrada int NOT NULL DEFAULT 0,
  tokens_saida int NOT NULL DEFAULT 0,
  tokens_cache_leitura int NOT NULL DEFAULT 0,
  tokens_cache_escrita int NOT NULL DEFAULT 0,
  custo_usd numeric(12,6) NOT NULL DEFAULT 0,
  duracao_ms int,
  mensagens_enviadas text[] NOT NULL DEFAULT '{}',
  ferramentas jsonb NOT NULL DEFAULT '[]',
  parada text,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ia_execucoes_empresa ON public.ia_execucoes (empresa_id, created_at DESC);
CREATE INDEX idx_ia_execucoes_conversa ON public.ia_execucoes (conversa_id, created_at);
CREATE INDEX idx_ia_execucoes_tarefa ON public.ia_execucoes (tarefa_id);
CREATE INDEX idx_ia_execucoes_lead ON public.ia_execucoes (crm_lead_id);
ALTER TABLE public.ia_execucoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ia_execucoes FROM anon, authenticated;
GRANT SELECT ON public.ia_execucoes TO authenticated;
GRANT ALL ON public.ia_execucoes TO service_role;
CREATE POLICY ia_execucoes_select ON public.ia_execucoes FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));
CREATE TRIGGER trg_ia_execucoes_valida_empresa BEFORE INSERT OR UPDATE ON public.ia_execucoes
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias(
    'conversa_id', 'conversas', 'crm_lead_id', 'crm_leads');

-- ---------------------------------------------------------------- vendedora de IA e robô do Chatwoot
ALTER TABLE public.salespeople ADD COLUMN eh_ia boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX salespeople_uma_ia_por_empresa ON public.salespeople (empresa_id) WHERE eh_ia;

ALTER TABLE public.chatwoot_conexoes ADD COLUMN alice_bot_id bigint;
ALTER TABLE public.chatwoot_conexao_segredos ADD COLUMN alice_bot_token text;

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
  SELECT * INTO cfg FROM public.ia_configuracoes WHERE empresa_id = NEW.empresa_id AND ativo;
  IF NOT FOUND THEN
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
    INSERT INTO public.ia_tarefas (empresa_id, conversa_id, tipo, motivo)
    VALUES (NEW.empresa_id, NEW.conversa_id, 'passar_para_humano', 'atendente humano escreveu na conversa')
    ON CONFLICT (conversa_id, tipo) WHERE situacao = 'pendente' DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.ia_agendar_por_mensagem() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_whatsapp_messages_ia AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION private.ia_agendar_por_mensagem();

-- Conversa que saiu de "pendente" (humano assumiu no Chatwoot): cancela a resposta agendada.
CREATE OR REPLACE FUNCTION private.ia_cancelar_fora_do_robo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' AND OLD.status = 'pending' THEN
    UPDATE public.ia_tarefas
       SET situacao = 'ignorada', motivo = 'conversa saiu do atendimento do robô', concluida_em = now()
     WHERE conversa_id = NEW.id AND tipo = 'responder' AND situacao = 'pendente';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.ia_cancelar_fora_do_robo() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conversas_ia_status AFTER UPDATE OF status ON public.conversas
  FOR EACH ROW EXECUTE FUNCTION private.ia_cancelar_fora_do_robo();

-- ---------------------------------------------------------------- tarefa pelo servidor
-- Reserva a tarefa para processar: só se ainda estiver pendente e no horário (uma mensagem nova
-- adia a tarefa; a chamada antiga da fila encontra executar_apos no futuro e desiste).
CREATE OR REPLACE FUNCTION public.ia_reservar_tarefa(_tarefa_id uuid)
RETURNS public.ia_tarefas LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  UPDATE public.ia_tarefas
     SET situacao = 'processando', iniciada_em = now(), tentativas = tentativas + 1
   WHERE id = _tarefa_id AND situacao = 'pendente' AND executar_apos <= now() + interval '1 second'
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.ia_reservar_tarefa(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_reservar_tarefa(uuid) TO service_role;
