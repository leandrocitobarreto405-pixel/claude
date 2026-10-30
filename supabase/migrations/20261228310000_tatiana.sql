-- Tatiana (gerente comercial), fase 2 (30/10/2026). Em bloco:
-- 1. Gatilho do orçamento: o lead guarda de onde veio a marca de "orçamento enviado" (app ou
--    conversa; a coluna já existia). Lead novo pega os orçamentos sem lead do mesmo telefone (até 60 dias): na Ecoprime o
--    orçamento nascia antes do lead e ficava solto. Preço passado pela equipe na conversa (texto ou
--    áudio transcrito com "R$ 123") marca o lead quando ainda não havia orçamento.
-- 2. Configuração por empresa: modo (desligado / teste / ativo), teto mensal e hora da noite.
-- 3. Caixinha e etiquetas na ficha do lead; noites (passadas da Tatiana), decisões por lead,
--    cobranças ("acertos no app") e recados do dia por pessoa. Leitura pelo app; quem grava é o
--    servidor e as funções abaixo.
-- 4. Tarefas da Tatiana reaproveitam crm_followups (trilha G), com mensagem pronta, motivo,
--    prioridade e motivo de pular.
-- 5. Pushes novos: tarefas do dia (equipe) e cobranças do dia (admin).
-- Nada é enviado a clientes; ia_configuracoes não muda.

-- 1. Gatilho do orçamento -------------------------------------------------------------------
-- crm_leads.orcamento_origem já existe (20261228210000: 'app', 'conversa' ou 'os').
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS orcamento_origem text CHECK (orcamento_origem IN ('app', 'conversa', 'os'));

-- Igual à versão de 20260929120000, com duas diferenças: a marca vinda da conversa (ou da OS) não é
-- apagada quando não há orçamento enviado no app, e a origem é guardada.
CREATE OR REPLACE FUNCTION private.atualizar_marcos_lead(_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.crm_leads;
  v_orcamento timestamptz;
  v_enviado_app timestamptz;
  v_enviado timestamptz;
  v_origem text;
  v_aprovado timestamptz;
  v_os timestamptz;
  v_agendado timestamptz;
  v_realizado timestamptz;
  v_faturado timestamptz;
BEGIN
  IF _lead_id IS NULL THEN RETURN; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id = _lead_id;
  IF l.id IS NULL THEN RETURN; END IF;

  SELECT min(q.created_at),
         CASE WHEN bool_or(q.status IN ('enviado', 'aprovado', 'recusado', 'convertido'))
              THEN coalesce(l.orcamento_enviado_em, now()) END,
         CASE WHEN bool_or(q.status IN ('aprovado', 'convertido'))
              THEN coalesce(l.orcamento_aprovado_em, now()) END
    INTO v_orcamento, v_enviado_app, v_aprovado
    FROM public.quotes q
   WHERE q.crm_lead_id = l.id AND q.empresa_id = l.empresa_id;

  v_enviado := coalesce(v_enviado_app,
                        CASE WHEN l.orcamento_origem IN ('conversa', 'os') THEN l.orcamento_enviado_em END);
  v_origem := CASE WHEN v_enviado IS NULL THEN NULL
                   WHEN l.orcamento_origem IS NOT NULL THEN l.orcamento_origem
                   ELSE 'app' END;

  IF l.linked_work_order_id IS NOT NULL THEN
    SELECT w.created_at INTO v_os FROM public.work_orders w
     WHERE w.id = l.linked_work_order_id AND w.empresa_id = l.empresa_id AND w.deleted_at IS NULL;
  END IF;

  IF v_os IS NOT NULL THEN
    SELECT min(v.created_at) FILTER (WHERE v.status IS DISTINCT FROM 'Cancelado'),
           min(coalesce((v.completion_date + coalesce(v.completion_time, time '12:00'))
                          AT TIME ZONE 'America/Sao_Paulo', v.updated_at))
             FILTER (WHERE v.status = 'Concluído')
      INTO v_agendado, v_realizado
      FROM public.visits v
     WHERE v.work_order_id = l.linked_work_order_id AND v.empresa_id = l.empresa_id;

    SELECT min((p.payment_date + time '12:00') AT TIME ZONE 'America/Sao_Paulo')
      INTO v_faturado
      FROM public.payments p
     WHERE p.work_order_id = l.linked_work_order_id AND p.empresa_id = l.empresa_id
       AND p.is_active AND p.payment_status = 'Pago';
  END IF;

  IF (l.orcamento_em, l.orcamento_enviado_em, l.orcamento_origem, l.orcamento_aprovado_em, l.os_criada_em,
      l.agendado_em, l.realizado_em, l.faturado_em)
     IS DISTINCT FROM (v_orcamento, v_enviado, v_origem, v_aprovado, v_os, v_agendado, v_realizado, v_faturado)
  THEN
    UPDATE public.crm_leads
       SET orcamento_em = v_orcamento, orcamento_enviado_em = v_enviado, orcamento_origem = v_origem,
           orcamento_aprovado_em = v_aprovado, os_criada_em = v_os, agendado_em = v_agendado,
           realizado_em = v_realizado, faturado_em = v_faturado
     WHERE id = l.id;
  END IF;
END $$;

-- Lead aberto (novo ou com telefone trocado) pega os orçamentos sem lead do mesmo telefone criados
-- nos últimos 60 dias. O gatilho dos orçamentos (trg_quotes_marcos) recalcula os marcos.
CREATE OR REPLACE FUNCTION private.crm_leads_pegar_orcamentos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.normalized_phone IS NULL OR NOT coalesce(NEW.is_open, true) THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.normalized_phone IS NOT DISTINCT FROM OLD.normalized_phone THEN
    RETURN NULL;
  END IF;
  UPDATE public.quotes q
     SET crm_lead_id = NEW.id
   WHERE q.empresa_id = NEW.empresa_id
     AND q.crm_lead_id IS NULL
     AND q.cliente_telefone IS NOT NULL
     AND q.created_at >= now() - interval '60 days'
     AND private.normalizar_telefone(q.cliente_telefone) = NEW.normalized_phone;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_crm_leads_pegar_orcamentos ON public.crm_leads;
CREATE TRIGGER trg_crm_leads_pegar_orcamentos AFTER INSERT OR UPDATE OF normalized_phone
  ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION private.crm_leads_pegar_orcamentos();

-- Preço passado pela equipe na conversa (texto ou áudio transcrito): marca o lead aberto que
-- ainda não tinha orçamento enviado. Alice (robô), campanhas (robô) e cliente não contam.
CREATE OR REPLACE FUNCTION private.mensagem_marca_preco()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lead uuid := NEW.crm_lead_id;
BEGIN
  IF v_lead IS NULL AND NEW.conversa_id IS NOT NULL THEN
    SELECT crm_lead_id INTO v_lead FROM public.conversas WHERE id = NEW.conversa_id;
  END IF;
  IF v_lead IS NULL THEN RETURN NULL; END IF;
  UPDATE public.crm_leads
     SET orcamento_enviado_em = NEW.message_timestamp, orcamento_origem = 'conversa'
   WHERE id = v_lead AND empresa_id = NEW.empresa_id
     AND orcamento_enviado_em IS NULL AND coalesce(is_open, true);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_whatsapp_messages_preco ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_messages_preco AFTER INSERT OR UPDATE OF transcricao
  ON public.whatsapp_messages FOR EACH ROW
  WHEN (NEW.direction = 'Enviada' AND NOT coalesce(NEW.privada, false)
        AND coalesce(NEW.remetente_tipo, 'user') = 'user'
        AND (coalesce(NEW.text_content, '') ~ 'R\$ ?[0-9]' OR coalesce(NEW.transcricao, '') ~* '(R\$ ?[0-9]|[0-9]+ reais)'))
  EXECUTE FUNCTION private.mensagem_marca_preco();

-- 2. Configuração por empresa ---------------------------------------------------------------
ALTER TABLE public.comercial_configuracoes
  ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'desligado' CHECK (modo IN ('desligado', 'teste', 'ativo')),
  ADD COLUMN IF NOT EXISTS teto_mensal_usd numeric(8,2) NOT NULL DEFAULT 10 CHECK (teto_mensal_usd >= 0),
  ADD COLUMN IF NOT EXISTS hora_noite time NOT NULL DEFAULT '21:30',
  ADD COLUMN IF NOT EXISTS alerta_teto_mes text;

-- 3. Caixinhas, noites, decisões, cobranças e recados -----------------------------------------
ALTER TABLE public.comercial_analises
  ADD COLUMN IF NOT EXISTS caixinha smallint CHECK (caixinha BETWEEN 1 AND 9),
  ADD COLUMN IF NOT EXISTS caixinha_em timestamptz,
  ADD COLUMN IF NOT EXISTS etiquetas jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS fora_area jsonb;

CREATE TABLE IF NOT EXISTS public.comercial_noites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  noite date NOT NULL,
  modo text NOT NULL CHECK (modo IN ('teste', 'ativo', 'conferencia')),
  leads uuid[] NOT NULL DEFAULT '{}',
  processados integer NOT NULL DEFAULT 0,
  com_erro integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'rodando' CHECK (status IN ('rodando', 'concluida', 'parada_teto', 'erro')),
  custo_usd numeric(10,5) NOT NULL DEFAULT 0,
  -- Conferência (só contagem, sem cobranças visíveis) e números da noite.
  resumo jsonb NOT NULL DEFAULT '{}'::jsonb,
  erro text,
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz,
  concluida_em timestamptz,
  UNIQUE (empresa_id, noite, modo)
);

CREATE TABLE IF NOT EXISTS public.comercial_decisoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  noite_id uuid NOT NULL REFERENCES public.comercial_noites(id) ON DELETE CASCADE,
  crm_lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  conversa_id uuid REFERENCES public.conversas(id) ON DELETE SET NULL,
  caixinha smallint CHECK (caixinha BETWEEN 1 AND 9),
  acao text NOT NULL CHECK (acao IN ('chamar', 'agendar', 'esperar', 'parar')),
  quando timestamptz,
  responsavel text CHECK (responsavel IN ('alice', 'equipe')),
  responsavel_user_id uuid,
  motivo text,
  mensagem text,
  motivo_perda_id uuid REFERENCES public.config_options(id) ON DELETE SET NULL,
  -- O que a cadência padrão faria (para comparar no teste).
  padrao_faria text,
  followup_id uuid REFERENCES public.crm_followups(id) ON DELETE SET NULL,
  executada boolean NOT NULL DEFAULT false,
  modelo text,
  custo_usd numeric(10,5) NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (noite_id, crm_lead_id)
);
CREATE INDEX IF NOT EXISTS idx_comercial_decisoes_lead ON public.comercial_decisoes (empresa_id, crm_lead_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.comercial_cobrancas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  noite_id uuid REFERENCES public.comercial_noites(id) ON DELETE SET NULL,
  crm_lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  conversa_id uuid REFERENCES public.conversas(id) ON DELETE SET NULL,
  -- Quem precisa acertar (responsável pela conversa ou caixa); null = sem dono (o admin vê).
  user_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('orcamento_sem_app', 'fechou_sem_os', 'remarcar', 'concluir_os',
                                     'pagamento', 'demora_resposta', 'demora_preco', 'cadastro')),
  texto text NOT NULL CHECK (length(texto) <= 400),
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  anuncio boolean NOT NULL DEFAULT false,
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'resolvida', 'ja_certo')),
  resolvida_em timestamptz,
  resolvida_por uuid,
  motivo text CHECK (length(motivo) <= 300),
  criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comercial_cobrancas_empresa ON public.comercial_cobrancas (empresa_id, situacao, criada_em DESC);
CREATE INDEX IF NOT EXISTS idx_comercial_cobrancas_user ON public.comercial_cobrancas (empresa_id, user_id, situacao);
-- Uma cobrança pendente por lead e tipo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comercial_cobrancas_pendente
  ON public.comercial_cobrancas (empresa_id, crm_lead_id, tipo) WHERE situacao = 'pendente';

CREATE TABLE IF NOT EXISTS public.comercial_recados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  dia date NOT NULL,
  frase text NOT NULL CHECK (length(frase) <= 200),
  resumo text CHECK (length(resumo) <= 600),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, user_id, dia)
);

-- Noites e decisões: só o admin lê. Cobranças e recados: o admin lê tudo; cada pessoa, os seus.
DO $p$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['comercial_noites', 'comercial_decisoes', 'comercial_cobrancas', 'comercial_recados'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $p$;
DROP POLICY IF EXISTS comercial_noites_select ON public.comercial_noites;
CREATE POLICY comercial_noites_select ON public.comercial_noites FOR SELECT TO authenticated USING (
  (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')))
  OR (SELECT private.is_nexa_admin()));
DROP POLICY IF EXISTS comercial_decisoes_select ON public.comercial_decisoes;
CREATE POLICY comercial_decisoes_select ON public.comercial_decisoes FOR SELECT TO authenticated USING (
  (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')))
  OR (SELECT private.is_nexa_admin()));
DROP POLICY IF EXISTS comercial_cobrancas_select ON public.comercial_cobrancas;
CREATE POLICY comercial_cobrancas_select ON public.comercial_cobrancas FOR SELECT TO authenticated USING (
  (empresa_id = (SELECT private.empresa_ativa())
   AND ((SELECT private.tem_papel('admin')) OR user_id = (SELECT auth.uid())))
  OR (SELECT private.is_nexa_admin()));
DROP POLICY IF EXISTS comercial_recados_select ON public.comercial_recados;
CREATE POLICY comercial_recados_select ON public.comercial_recados FOR SELECT TO authenticated USING (
  (empresa_id = (SELECT private.empresa_ativa())
   AND ((SELECT private.tem_papel('admin')) OR user_id = (SELECT auth.uid())))
  OR (SELECT private.is_nexa_admin()));

-- Resolver uma cobrança ("feito" ou "já está certo"): a própria pessoa ou o admin.
CREATE OR REPLACE FUNCTION public.comercial_resolver_cobranca(_id uuid, _situacao text, _motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  emp uuid := private.empresa_ativa();
BEGIN
  IF emp IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501'; END IF;
  IF _situacao NOT IN ('resolvida', 'ja_certo', 'pendente') THEN RAISE EXCEPTION 'Situação inválida.'; END IF;
  UPDATE public.comercial_cobrancas
     SET situacao = _situacao,
         resolvida_em = CASE WHEN _situacao = 'pendente' THEN NULL ELSE now() END,
         resolvida_por = CASE WHEN _situacao = 'pendente' THEN NULL ELSE auth.uid() END,
         motivo = CASE WHEN _situacao = 'ja_certo' THEN left(nullif(btrim(_motivo), ''), 300) END
   WHERE id = _id AND empresa_id = emp
     AND (user_id = auth.uid() OR private.tem_papel('admin'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobrança não encontrada.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.comercial_resolver_cobranca(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comercial_resolver_cobranca(uuid, text, text) TO authenticated;

-- 4. Tarefas da Tatiana em crm_followups (trilha G) ----------------------------------------------
ALTER TABLE public.crm_followups
  ADD COLUMN IF NOT EXISTS origem text CHECK (origem IN ('gerente')),
  ADD COLUMN IF NOT EXISTS mensagem text CHECK (length(mensagem) <= 1000),
  ADD COLUMN IF NOT EXISTS motivo text CHECK (length(motivo) <= 300),
  ADD COLUMN IF NOT EXISTS prioridade smallint CHECK (prioridade BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS pulado_motivo text CHECK (length(pulado_motivo) <= 300);
ALTER TABLE public.crm_followups DROP CONSTRAINT IF EXISTS crm_followups_trilha_check;
ALTER TABLE public.crm_followups ADD CONSTRAINT crm_followups_trilha_check
  CHECK (trilha IS NULL OR trilha IN ('A', 'B', 'C', 'G'));
CREATE INDEX IF NOT EXISTS idx_crm_followups_gerente ON public.crm_followups (empresa_id, scheduled_at)
  WHERE origem = 'gerente';

-- 5. Pushes novos -------------------------------------------------------------------------------
ALTER TABLE public.push_preferencias
  ADD COLUMN IF NOT EXISTS tatiana_tarefas boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tatiana_cobrancas boolean NOT NULL DEFAULT true;
ALTER TABLE public.push_envios DROP CONSTRAINT IF EXISTS push_envios_tipo_check;
ALTER TABLE public.push_envios ADD CONSTRAINT push_envios_tipo_check
  CHECK (tipo IN ('cliente_esperando', 'servico_concluido', 'campanha_aprovacao', 'agendamento_promocao',
                  'resumo_dia', 'teste', 'tatiana_tarefas', 'tatiana_cobrancas'));

-- Dados: Ecoprime ligada em modo desligado (a conferência roda antes de ligar), teto mensal US$ 10;
-- Turbine com teto mensal de US$ 15. Nada roda sozinho até o modo mudar.
INSERT INTO public.comercial_configuracoes (empresa_id, ligado, teto_mensal_usd)
SELECT id, true, 10 FROM public.empresas WHERE id = 'f1b06dbe-39dc-4344-89f7-dd27a68046d8'
ON CONFLICT (empresa_id) DO NOTHING;
UPDATE public.comercial_configuracoes SET teto_mensal_usd = 15
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111';

SELECT private.instalar_travas_somente_leitura();
