-- Leads do site: cadastros das landing pages (lidos das planilhas Google, só leitura) e quem
-- chamou ou não no WhatsApp. Só acrescenta. Os avisos são só no app: mkt_avisos ganha
-- "so_no_app", que o envio para o WhatsApp da equipe nunca pega. O envio do modelo para o lead
-- começa DESLIGADO.

-- 1. Avisos que nunca vão para o WhatsApp da equipe (só no sino do app).
ALTER TABLE public.mkt_avisos
  ADD COLUMN IF NOT EXISTS so_no_app boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mkt_avisos_so_no_app_check') THEN
    ALTER TABLE public.mkt_avisos ADD CONSTRAINT mkt_avisos_so_no_app_check
      CHECK (NOT so_no_app OR whatsapp_enviado_em IS NULL);
  END IF;
END $$;

-- 2. De onde veio o lead do site (preenchido só quando vazio; a origem do lead não muda).
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS lp_origem text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS gclid text,
  ADD COLUMN IF NOT EXISTS gbraid text;

-- 3. Planilhas das landing pages (uma linha por LP).
CREATE TABLE IF NOT EXISTS public.leads_site_planilhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 80),
  planilha_id text NOT NULL CHECK (planilha_id ~ '^[A-Za-z0-9_-]{20,100}$'),
  aba text NOT NULL DEFAULT 'Leads' CHECK (length(btrim(aba)) BETWEEN 1 AND 100),
  ativa boolean NOT NULL DEFAULT true,
  -- Última linha da aba já lida (1 = cabeçalho). Só linhas depois dela entram.
  ultima_linha int NOT NULL DEFAULT 1 CHECK (ultima_linha >= 1),
  lido_em timestamptz,
  erro text,
  erro_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, planilha_id, aba)
);
ALTER TABLE public.leads_site_planilhas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leads_site_planilhas FROM anon, authenticated;
GRANT SELECT ON public.leads_site_planilhas TO authenticated;
GRANT ALL ON public.leads_site_planilhas TO service_role;
CREATE POLICY leads_site_planilhas_select ON public.leads_site_planilhas FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa())
         AND (SELECT private.meu_papel()) IN ('admin', 'atendente'));

-- 4. Cada cadastro (uma linha da planilha).
CREATE TABLE IF NOT EXISTS public.leads_site (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  planilha_id uuid NOT NULL REFERENCES public.leads_site_planilhas(id) ON DELETE CASCADE,
  linha int NOT NULL,
  lp text NOT NULL,
  cadastrado_em timestamptz NOT NULL,
  nome text,
  telefone_digitado text,
  -- 55 + DDD + número; NULL quando o número é inválido.
  telefone text,
  servico text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  gclid text,
  gbraid text,
  wbraid text,
  fbclid text,
  pagina text,
  -- nao_chamou, chamou, invalido, chamado_equipe.
  situacao text NOT NULL CHECK (situacao IN ('nao_chamou', 'chamou', 'invalido', 'chamado_equipe')),
  chamou_em timestamptz,
  chamado_equipe_em timestamptz,
  chamado_por uuid,
  crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  conversa_id uuid REFERENCES public.conversas(id) ON DELETE SET NULL,
  -- Mesmo telefone em até 30 min: é o mesmo cadastro (fica escondido e aponta para o primeiro).
  repetido_de uuid REFERENCES public.leads_site(id) ON DELETE SET NULL,
  aviso_em timestamptz,
  modelo_enviado_em timestamptz,
  modelo_erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (planilha_id, linha)
);
CREATE INDEX IF NOT EXISTS idx_leads_site_empresa ON public.leads_site (empresa_id, cadastrado_em DESC);
CREATE INDEX IF NOT EXISTS idx_leads_site_telefone
  ON public.leads_site (empresa_id, private.telefone_chave(telefone), cadastrado_em DESC);
CREATE INDEX IF NOT EXISTS idx_leads_site_pendentes
  ON public.leads_site (empresa_id, cadastrado_em) WHERE situacao IN ('nao_chamou', 'chamado_equipe');
ALTER TABLE public.leads_site ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leads_site FROM anon, authenticated;
GRANT SELECT ON public.leads_site TO authenticated;
GRANT ALL ON public.leads_site TO service_role;
CREATE POLICY leads_site_select ON public.leads_site FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa())
         AND (SELECT private.meu_papel()) IN ('admin', 'atendente'));

-- 5. Configuração por empresa: aviso no app e envio do modelo (DESLIGADO).
CREATE TABLE IF NOT EXISTS public.leads_site_configuracoes (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  aviso_minutos int NOT NULL DEFAULT 10 CHECK (aviso_minutos BETWEEN 5 AND 120),
  envio_ligado boolean NOT NULL DEFAULT false,
  -- Só cadastros lidos depois de "Ativar" recebem o modelo.
  envio_ativado_em timestamptz,
  envio_apos_minutos int NOT NULL DEFAULT 15 CHECK (envio_apos_minutos BETWEEN 5 AND 240),
  envio_hora_inicio time NOT NULL DEFAULT '08:00',
  envio_hora_fim time NOT NULL DEFAULT '20:00' CHECK (envio_hora_fim > envio_hora_inicio),
  envio_modelo text NOT NULL DEFAULT 'tc_lead_site' CHECK (envio_modelo ~ '^[a-z0-9_]+$' AND length(envio_modelo) <= 512),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.leads_site_configuracoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leads_site_configuracoes FROM anon, authenticated;
GRANT SELECT ON public.leads_site_configuracoes TO authenticated;
GRANT ALL ON public.leads_site_configuracoes TO service_role;
CREATE POLICY leads_site_configuracoes_select ON public.leads_site_configuracoes FOR SELECT
  TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa())
         AND (SELECT private.meu_papel()) IN ('admin', 'atendente'));

-- 6. Grava as linhas novas de uma planilha (o servidor já leu e conferiu o telefone).
-- Cada linha: linha, cadastrado_em, nome, telefone_digitado, telefone (NULL = inválido), servico,
-- utm_*, gclid, gbraid, wbraid, fbclid, pagina. Linha já gravada não entra de novo.
CREATE OR REPLACE FUNCTION public.leads_site_registrar(_planilha uuid, _linhas jsonb, _ultima int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.leads_site_planilhas;
  r record;
  primeiro uuid;
  novos int := 0;
  repetidos int := 0;
BEGIN
  SELECT * INTO p FROM public.leads_site_planilhas WHERE id = _planilha FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'planilha não encontrada';
  END IF;
  FOR r IN
    SELECT * FROM jsonb_to_recordset(coalesce(_linhas, '[]')) AS t(
      linha int, cadastrado_em timestamptz, nome text, telefone_digitado text, telefone text,
      servico text, utm_source text, utm_medium text, utm_campaign text, utm_term text,
      utm_content text, gclid text, gbraid text, wbraid text, fbclid text, pagina text)
     WHERE t.linha > p.ultima_linha
     ORDER BY t.linha
  LOOP
    primeiro := NULL;
    IF r.telefone IS NOT NULL THEN
      SELECT s.id INTO primeiro FROM public.leads_site s
       WHERE s.empresa_id = p.empresa_id AND s.repetido_de IS NULL
         AND private.telefone_chave(s.telefone) = private.telefone_chave(r.telefone)
         AND s.cadastrado_em BETWEEN r.cadastrado_em - interval '30 minutes' AND r.cadastrado_em
       ORDER BY s.cadastrado_em LIMIT 1;
    END IF;
    INSERT INTO public.leads_site (empresa_id, planilha_id, linha, lp, cadastrado_em, nome,
      telefone_digitado, telefone, servico, utm_source, utm_medium, utm_campaign, utm_term,
      utm_content, gclid, gbraid, wbraid, fbclid, pagina, situacao, repetido_de)
    VALUES (p.empresa_id, p.id, r.linha, p.nome, r.cadastrado_em, left(r.nome, 120),
      left(r.telefone_digitado, 40), r.telefone, left(r.servico, 120), left(r.utm_source, 300),
      left(r.utm_medium, 300), left(r.utm_campaign, 300), left(r.utm_term, 300),
      left(r.utm_content, 300), left(r.gclid, 300), left(r.gbraid, 300), left(r.wbraid, 300),
      left(r.fbclid, 300), left(r.pagina, 2000),
      CASE WHEN r.telefone IS NULL THEN 'invalido' ELSE 'nao_chamou' END, primeiro)
    ON CONFLICT (planilha_id, linha) DO NOTHING;
    IF FOUND THEN
      novos := novos + 1;
      IF primeiro IS NOT NULL THEN repetidos := repetidos + 1; END IF;
    END IF;
  END LOOP;
  UPDATE public.leads_site_planilhas
     SET ultima_linha = greatest(ultima_linha, coalesce(_ultima, ultima_linha)), lido_em = now(),
         erro = NULL, erro_em = NULL, updated_at = now()
   WHERE id = p.id;
  RETURN jsonb_build_object('novos', novos, 'repetidos', repetidos);
END $$;
REVOKE ALL ON FUNCTION public.leads_site_registrar(uuid, jsonb, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leads_site_registrar(uuid, jsonb, int) TO service_role;

-- 7. Quem chamou no WhatsApp: mensagem recebida do mesmo telefone (9º dígito pela chave) a partir
-- de 1 h antes do cadastro. Liga ao lead do CRM e preenche LP, utm_term, gclid e gbraid só onde
-- estiverem vazios.
CREATE OR REPLACE FUNCTION public.leads_site_atualizar(_emp uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  m record;
  lead uuid;
  chamaram int := 0;
BEGIN
  FOR r IN
    SELECT s.* FROM public.leads_site s
     WHERE s.empresa_id = _emp AND s.repetido_de IS NULL AND s.telefone IS NOT NULL
       AND s.situacao IN ('nao_chamou', 'chamado_equipe')
       -- Últimos 30 dias; cadastro antigo recém-importado é conferido uma vez também.
       AND (s.cadastrado_em >= now() - interval '30 days' OR s.created_at >= now() - interval '1 hour')
  LOOP
    SELECT coalesce(w.message_timestamp, w.created_at) AS quando, w.conversa_id, w.crm_lead_id
      INTO m
      FROM public.whatsapp_messages w
      JOIN public.whatsapp_contacts c ON c.id = w.whatsapp_contact_id
     WHERE w.empresa_id = _emp AND w.direction = 'Recebida' AND NOT w.privada
       AND c.empresa_id = _emp
       AND private.telefone_chave(c.normalized_phone) = private.telefone_chave(r.telefone)
       AND coalesce(w.message_timestamp, w.created_at) >= r.cadastrado_em - interval '1 hour'
     ORDER BY coalesce(w.message_timestamp, w.created_at)
     LIMIT 1;
    CONTINUE WHEN m.quando IS NULL;
    lead := coalesce(
      (SELECT crm_lead_id FROM public.conversas WHERE id = m.conversa_id),
      m.crm_lead_id,
      (SELECT l.id FROM public.crm_leads l
        WHERE l.empresa_id = _emp
          AND private.telefone_chave(l.normalized_phone) = private.telefone_chave(r.telefone)
        ORDER BY l.is_open DESC, coalesce(l.last_interaction_at, l.created_at) DESC
        LIMIT 1));
    UPDATE public.leads_site
       SET situacao = 'chamou', chamou_em = m.quando, conversa_id = m.conversa_id,
           crm_lead_id = coalesce(lead, crm_lead_id)
     WHERE id = r.id;
    chamaram := chamaram + 1;
    IF lead IS NOT NULL THEN
      UPDATE public.crm_leads
         SET lp_origem = coalesce(lp_origem, r.lp), utm_term = coalesce(utm_term, r.utm_term),
             gclid = coalesce(gclid, r.gclid), gbraid = coalesce(gbraid, r.gbraid)
       WHERE id = lead
         AND (lp_origem IS NULL OR (utm_term IS NULL AND r.utm_term IS NOT NULL)
              OR (gclid IS NULL AND r.gclid IS NOT NULL) OR (gbraid IS NULL AND r.gbraid IS NOT NULL));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('chamaram', chamaram);
END $$;
REVOKE ALL ON FUNCTION public.leads_site_atualizar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leads_site_atualizar(uuid) TO service_role;
