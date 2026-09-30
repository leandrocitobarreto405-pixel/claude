-- Marketing e follow-up pelo WhatsApp (campanhas do calendário e gatilhos por data).
--
--  * mkt_contatos: base de marketing (compradores e não compradores), um por telefone por empresa
--    (telefone casado por DDD + últimos 8 dígitos, como ads_clicks: há contatos sem o 9º dígito).
--  * Motor de grupos (C1–C5, N1–N3) com histórico mensal; campanhas do calendário preparadas
--    10 dias antes, aprovadas no Nexa e disparadas pelo próprio Nexa (API do Chatwoot), em lotes
--    espaçados, terça a quinta às 10h, com pausa automática (erro > 5% ou opt-out + bloqueio > 3%).
--  * Gatilhos diários C1 (pós-venda), C2 (6 meses), C3 (13º mês + lembrete).
--  * Respostas e vendas ligadas ao envio (mkt_envios); nada de marketing em crm_leads.
--  * Tudo que envia fica atrás de flags em mkt_configuracoes, todas desligadas por padrão.

-- ---------------------------------------------------------------- correção da captação de anúncios
-- "higienização" não era reconhecida no campo servico (só "higen", do domínio da landing).
CREATE OR REPLACE FUNCTION public.ads_registrar_clique(_host text, _ip_hash text, _dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp uuid;
  host text := lower(btrim(coalesce(_host, '')));
  d jsonb := CASE WHEN jsonb_typeof(_dados) = 'object' THEN _dados ELSE '{}'::jsonb END;
  avisos text[] := '{}';
  telefone text := private.ads_texto(d->>'telefone', 40);
  fone text := private.normalizar_telefone(private.ads_texto(d->>'telefone', 40));
  ids jsonb := '{}';
  campo text;
  valor text;
  servico_txt text := lower(coalesce(private.ads_texto(d->>'servico', 60), ''));
  v_servico text;
  pagina text := private.ads_texto(d->>'page_url', 2000);
  existente uuid;
  novo uuid;
  lead uuid;
  tentativas int;
BEGIN
  SELECT empresa_id INTO emp FROM public.ads_dominios WHERE dominio = host;
  IF emp IS NULL THEN
    INSERT INTO public.ads_eventos (tipo, resultado, ip_hash, detalhe)
    VALUES ('captacao', 'dominio_desconhecido', nullif(_ip_hash, ''), jsonb_build_object('host', left(host, 200)));
    RETURN jsonb_build_object('resultado', 'dominio_desconhecido');
  END IF;

  -- Limite por IP: 20 envios em 10 minutos (qualquer resultado conta).
  SELECT count(*) INTO tentativas FROM public.ads_eventos
   WHERE tipo = 'captacao' AND ip_hash = _ip_hash AND created_at > now() - interval '10 minutes';
  IF nullif(_ip_hash, '') IS NOT NULL AND tentativas >= 20 THEN
    INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, ip_hash, detalhe)
    VALUES (emp, 'captacao', 'limite', nullif(_ip_hash, ''), jsonb_build_object('tentativas', tentativas));
    RETURN jsonb_build_object('resultado', 'limite');
  END IF;

  IF fone IS NULL OR fone !~ '^55[1-9][0-9][0-9]{8,9}$' THEN
    INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, ip_hash, detalhe)
    VALUES (emp, 'captacao', 'invalido', nullif(_ip_hash, ''),
            jsonb_build_object('motivo', 'telefone inválido', 'telefone', left(coalesce(telefone, ''), 40)));
    RETURN jsonb_build_object('resultado', 'invalido', 'motivo', 'telefone inválido');
  END IF;

  -- IDs de clique: só letras, números, ponto, _ e -; valor estranho é descartado (com aviso).
  FOREACH campo IN ARRAY ARRAY['gclid', 'gbraid', 'wbraid', 'fbclid'] LOOP
    valor := private.ads_texto(d->>campo, 1000);
    IF valor IS NOT NULL AND (valor !~ '^[A-Za-z0-9._-]+$' OR length(valor) NOT BETWEEN 4 AND 600) THEN
      avisos := avisos || (campo || ' descartado');
      valor := NULL;
    END IF;
    ids := ids || jsonb_build_object(campo, valor);
  END LOOP;

  -- Serviço: o que a landing mandou; senão, pelo endereço da página.
  v_servico := CASE
    WHEN servico_txt LIKE '%imper%' THEN 'impermeabilizacao'
    WHEN servico_txt ~ 'hig[ie]{1,2}n' THEN 'higienizacao'
    WHEN lower(coalesce(pagina, '') || ' ' || host) LIKE '%imper%' THEN 'impermeabilizacao'
    WHEN lower(coalesce(pagina, '') || ' ' || host) ~ 'hig[ie]{1,2}n' THEN 'higienizacao'
  END;
  IF v_servico IS NULL THEN avisos := avisos || 'serviço não identificado'::text; END IF;

  -- Idempotência: mesmo telefone + mesmo gclid na última hora = mesmo envio.
  PERFORM pg_advisory_xact_lock(hashtextextended(emp::text || '|' || fone || '|' || coalesce(ids->>'gclid', ''), 0));
  SELECT id INTO existente FROM public.ads_clicks
   WHERE empresa_id = emp AND normalized_phone = fone
     AND gclid IS NOT DISTINCT FROM (ids->>'gclid')
     AND created_at > now() - interval '1 hour'
   ORDER BY created_at DESC LIMIT 1;
  IF existente IS NOT NULL THEN
    INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, ads_click_id, ip_hash)
    VALUES (emp, 'captacao', 'duplicado', existente, nullif(_ip_hash, ''));
    RETURN jsonb_build_object('resultado', 'duplicado', 'id', existente);
  END IF;

  INSERT INTO public.ads_clicks (empresa_id, nome, telefone_raw, normalized_phone, gclid, gbraid,
    wbraid, fbclid, utm_source, utm_medium, utm_campaign, utm_term, utm_content, page_url, servico)
  VALUES (emp, private.ads_texto(d->>'nome', 120), telefone, fone, ids->>'gclid', ids->>'gbraid',
    ids->>'wbraid', ids->>'fbclid', private.ads_texto(d->>'utm_source', 300),
    private.ads_texto(d->>'utm_medium', 300), private.ads_texto(d->>'utm_campaign', 300),
    private.ads_texto(d->>'utm_term', 300), private.ads_texto(d->>'utm_content', 300), pagina, v_servico)
  RETURNING id INTO novo;

  -- Lead que já existe (chamou antes do pop-up ou é contato recente): liga agora.
  SELECT l.id INTO lead FROM public.crm_leads l
   WHERE l.empresa_id = emp
     AND private.telefone_chave(l.normalized_phone) = private.telefone_chave(fone)
     AND coalesce(l.last_interaction_at, l.created_at) >= now() - interval '90 days'
   ORDER BY coalesce(l.last_interaction_at, l.created_at) DESC
   LIMIT 1;
  IF lead IS NOT NULL THEN
    UPDATE public.ads_clicks SET crm_lead_id = lead, vinculado_em = now() WHERE id = novo;
    INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, ads_click_id, detalhe)
    VALUES (emp, 'vinculo', 'vinculado', novo, jsonb_build_object('crm_lead_id', lead, 'origem', 'clique'));
  END IF;

  -- Mensagem que chegou antes do pop-up terminar de enviar (até 10 min antes).
  UPDATE public.ads_clicks a SET whatsapp_iniciado_em = m.primeira
    FROM (SELECT min(coalesce(w.message_timestamp, w.created_at)) AS primeira
            FROM public.whatsapp_messages w
            JOIN public.whatsapp_contacts c ON c.id = w.whatsapp_contact_id
           WHERE w.empresa_id = emp AND w.direction = 'Recebida'
             AND private.telefone_chave(c.normalized_phone) = private.telefone_chave(fone)
             AND coalesce(w.message_timestamp, w.created_at) >= now() - interval '10 minutes') m
   WHERE a.id = novo AND m.primeira IS NOT NULL;

  INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, ads_click_id, ip_hash, detalhe)
  VALUES (emp, 'captacao', 'gravado', novo, nullif(_ip_hash, ''),
          jsonb_build_object('avisos', to_jsonb(avisos), 'lead', lead));
  RETURN jsonb_build_object('resultado', 'gravado', 'id', novo, 'avisos', to_jsonb(avisos),
                            'crm_lead_id', lead);
END $$;

-- ---------------------------------------------------------------- utilitários
-- Primeiro nome confiável para o modelo ({{1}}); NULL → variante "_sn" (sem nome).
CREATE OR REPLACE FUNCTION private.mkt_primeiro_nome(_nome text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN w ~ '^[a-zà-öø-ÿ][a-zà-öø-ÿ''-]{1,19}$'
     AND w NOT IN ('cliente', 'sr', 'sra', 'srta', 'dona', 'dr', 'dra', 'seu', 'senhor', 'senhora',
                   'whatsapp', 'contato', 'teste', 'nao', 'não', 'sem', 'nome', 'turbine', 'clean',
                   'casa', 'loja', 'empresa', 'amor', 'mae', 'mãe', 'pai', 'vo', 'vó', 'tia', 'tio')
    THEN initcap(w)
  END
  FROM (SELECT lower(split_part(btrim(regexp_replace(coalesce(_nome, ''), '\s+', ' ', 'g')), ' ', 1)) AS w) s;
$$;
REVOKE ALL ON FUNCTION private.mkt_primeiro_nome(text) FROM PUBLIC, anon, authenticated;
-- O servidor (chave de serviço) grava contatos e indicações direto; os índices e gatilhos de
-- telefone rodam com as permissões dele.
GRANT EXECUTE ON FUNCTION private.telefone_chave(text), private.normalizar_telefone(text),
  private.mkt_primeiro_nome(text) TO service_role;

-- Tipo de serviço a partir de um texto livre.
CREATE OR REPLACE FUNCTION private.mkt_tipo_servico(_texto text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN t LIKE '%imper%' THEN 'impermeabilizacao'
    WHEN t ~ 'hig[ie]{1,2}n|limpeza|lavagem' THEN 'higienizacao'
    ELSE 'desconhecido'
  END
  FROM (SELECT lower(coalesce(_texto, '')) AS t) s;
$$;
REVOKE ALL ON FUNCTION private.mkt_tipo_servico(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- configuração (flags)
CREATE TABLE public.mkt_configuracoes (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  -- Envio das campanhas aprovadas (lotes nas datas). Desligado: nada sai, mesmo aprovado.
  disparo_ligado boolean NOT NULL DEFAULT false,
  -- Gatilhos automáticos (desligados: a lista do dia fica na tela "Gatilhos de hoje").
  gatilho_c1_ligado boolean NOT NULL DEFAULT false,
  gatilho_c2_ligado boolean NOT NULL DEFAULT false,
  gatilho_c3_ligado boolean NOT NULL DEFAULT false,
  -- Preparação automática (não envia nada): dia 1 recalcula grupos; D-10 monta a campanha.
  preparo_automatico boolean NOT NULL DEFAULT true,
  dias_antes_preparo int NOT NULL DEFAULT 10 CHECK (dias_antes_preparo BETWEEN 2 AND 30),
  -- Aviso no WhatsApp do dono (modelo de utilidade com {{1}} = texto do aviso).
  aviso_whatsapp_ligado boolean NOT NULL DEFAULT false,
  aviso_telefone text,
  aviso_template_nome text,
  template_idioma text NOT NULL DEFAULT 'pt_BR',
  custo_msg_estimado numeric(8,2) NOT NULL DEFAULT 0.32 CHECK (custo_msg_estimado >= 0),
  lote_tamanho int NOT NULL DEFAULT 350 CHECK (lote_tamanho BETWEEN 1 AND 2000),
  intervalo_segundos int NOT NULL DEFAULT 8 CHECK (intervalo_segundos BETWEEN 1 AND 600),
  hora_disparo int NOT NULL DEFAULT 10 CHECK (hora_disparo BETWEEN 8 AND 20),
  hora_limite int NOT NULL DEFAULT 19 CHECK (hora_limite BETWEEN 9 AND 21),
  limite_erro_pct numeric(5,2) NOT NULL DEFAULT 5,
  limite_optout_pct numeric(5,2) NOT NULL DEFAULT 3,
  amostra_minima int NOT NULL DEFAULT 20 CHECK (amostra_minima >= 1),
  link_avaliacao_google text,
  -- Caixa do WhatsApp no Chatwoot de onde saem as campanhas (vazio: a única caixa da empresa).
  chatwoot_inbox_id bigint,
  -- Texto do botão (sem acento/pontuação) → ação.
  botoes jsonb NOT NULL DEFAULT '{
    "nao quero mais ofertas": "optout",
    "agora nao": "recusou",
    "ja resolvi": "recusou",
    "tive um problema": "problema",
    "ficou otimo": "elogio",
    "quero ver as datas": "interesse",
    "quero ver horarios": "interesse",
    "quero o valor": "interesse",
    "quero orcamento": "interesse"
  }',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mkt_configuracoes_aviso CHECK (
    NOT aviso_whatsapp_ligado OR (aviso_telefone IS NOT NULL AND aviso_template_nome IS NOT NULL)),
  CONSTRAINT mkt_configuracoes_janela CHECK (hora_disparo < hora_limite)
);

-- ---------------------------------------------------------------- contatos
CREATE TABLE public.mkt_contatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome text,
  primeiro_nome text,
  normalized_phone text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('comprador', 'nao_comprador')),
  ultimo_servico_em timestamptz,
  ultimo_servico_tipo text CHECK (ultimo_servico_tipo IN ('higienizacao', 'impermeabilizacao', 'desconhecido')),
  ultima_work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  -- Quando a última OS ficou concluída e paga (gatilho C1, no dia seguinte).
  pos_venda_em timestamptz,
  lead_entrada_em timestamptz,
  servico_interesse text,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  grupo_atual text CHECK (grupo_atual IN ('C1', 'C2', 'C3', 'C4', 'C5', 'N1', 'N2', 'N3')),
  grupo_calculado_em timestamptz,
  optout_em timestamptz,
  sem_pos_venda boolean NOT NULL DEFAULT false,
  -- "Agora não" / "Já resolvi": não recebe outro disparo desse grupo neste ciclo.
  recusou_grupo text,
  recusou_em timestamptz,
  credito_indicacao_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (credito_indicacao_pct BETWEEN 0 AND 100),
  indicado_por_contato_id uuid REFERENCES public.mkt_contatos(id) ON DELETE SET NULL,
  origem_importacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Um contato por telefone por empresa, casando com e sem o 9º dígito.
CREATE UNIQUE INDEX mkt_contatos_telefone_key
  ON public.mkt_contatos (empresa_id, private.telefone_chave(normalized_phone));
CREATE INDEX idx_mkt_contatos_normalized_phone ON public.mkt_contatos (normalized_phone);
CREATE INDEX idx_mkt_contatos_grupo ON public.mkt_contatos (empresa_id, grupo_atual);
CREATE INDEX idx_mkt_contatos_customer ON public.mkt_contatos (customer_id);
CREATE INDEX idx_mkt_contatos_lead ON public.mkt_contatos (crm_lead_id);
CREATE INDEX idx_mkt_contatos_indicador ON public.mkt_contatos (indicado_por_contato_id);
CREATE INDEX idx_mkt_contatos_os ON public.mkt_contatos (ultima_work_order_id);

CREATE TABLE public.mkt_grupos_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  contato_id uuid NOT NULL REFERENCES public.mkt_contatos(id) ON DELETE CASCADE,
  mes_ref date NOT NULL CHECK (extract(day FROM mes_ref) = 1),
  grupo text CHECK (grupo IN ('C1', 'C2', 'C3', 'C4', 'C5', 'N1', 'N2', 'N3')),
  motivo_fora text,
  calculado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contato_id, mes_ref)
);
CREATE INDEX idx_mkt_grupos_historico_mes ON public.mkt_grupos_historico (empresa_id, mes_ref, grupo);

-- ---------------------------------------------------------------- campanhas, lotes e envios
CREATE TABLE public.mkt_campanhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('calendario', 'gatilho')),
  mes_ref date NOT NULL CHECK (extract(day FROM mes_ref) = 1),
  tema text,
  grupos text[] NOT NULL DEFAULT '{}',
  -- Calendário: modelo por grupo ({"C4": "tc_oferta_trimestral", ...}); gatilho: template_nome.
  templates jsonb NOT NULL DEFAULT '{}',
  template_nome text,
  gatilho text CHECK (gatilho IN ('C1', 'C2', 'C3', 'C3L')),
  datas_disparo date[] NOT NULL DEFAULT '{}',
  -- Limite de contatos por grupo (ex.: {"N3": 250} para teste).
  limites jsonb NOT NULL DEFAULT '{}',
  condicao_texto text,
  condicao_pct numeric(5,2) CHECK (condicao_pct IS NULL OR condicao_pct BETWEEN 0 AND 25),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN (
    'rascunho', 'aguardando_aprovacao', 'aprovada', 'bloqueada', 'recusada', 'expirada',
    'enviando', 'pausada', 'concluida')),
  motivo_status text,
  custo_msg_estimado numeric(8,2) NOT NULL DEFAULT 0.32,
  estimativa jsonb,
  crm_campaign_id uuid REFERENCES public.crm_campaigns(id) ON DELETE SET NULL,
  preparada_em timestamptz,
  aprovada_em timestamptz,
  aprovada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recusada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mkt_campanhas_gatilho CHECK ((tipo = 'gatilho') = (gatilho IS NOT NULL))
);
CREATE INDEX idx_mkt_campanhas_empresa ON public.mkt_campanhas (empresa_id, mes_ref, status);
CREATE UNIQUE INDEX mkt_campanhas_gatilho_mes_key
  ON public.mkt_campanhas (empresa_id, gatilho, mes_ref) WHERE tipo = 'gatilho';
CREATE INDEX idx_mkt_campanhas_crm ON public.mkt_campanhas (crm_campaign_id);
CREATE INDEX idx_mkt_campanhas_aprovador ON public.mkt_campanhas (aprovada_por);

CREATE TABLE public.mkt_lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  campanha_id uuid NOT NULL REFERENCES public.mkt_campanhas(id) ON DELETE CASCADE,
  numero int NOT NULL,
  etiqueta_chatwoot text NOT NULL,
  data_prevista date NOT NULL,
  quantidade int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'preparado' CHECK (status IN (
    'preparado', 'aprovado', 'enviando', 'pausado', 'concluido', 'cancelado')),
  motivo_pausa text,
  -- Retomada depois de uma pausa: as travas contam só os envios a partir daqui.
  retomado_em timestamptz,
  sincronizado_em timestamptz,
  iniciado_em timestamptz,
  concluido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campanha_id, numero)
);
CREATE INDEX idx_mkt_lotes_status ON public.mkt_lotes (status, data_prevista);
CREATE INDEX idx_mkt_lotes_empresa ON public.mkt_lotes (empresa_id);

CREATE TABLE public.mkt_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  campanha_id uuid NOT NULL REFERENCES public.mkt_campanhas(id) ON DELETE CASCADE,
  lote_id uuid REFERENCES public.mkt_lotes(id) ON DELETE CASCADE,
  contato_id uuid NOT NULL REFERENCES public.mkt_contatos(id) ON DELETE CASCADE,
  normalized_phone text NOT NULL,
  grupo text,
  template_nome text NOT NULL,
  variante_sn boolean NOT NULL DEFAULT false,
  ordem int NOT NULL DEFAULT 0,
  -- Gatilhos: chave que impede repetir o mesmo toque (ex.: "C1:<os>", "C3L:<envio>").
  gatilho_ref text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN (
    'pendente', 'manual', 'enviando', 'enviado', 'erro', 'cancelado')),
  agendado_para timestamptz,
  reservado_em timestamptz,
  enviado_em timestamptz,
  erro text,
  bloqueio boolean NOT NULL DEFAULT false,
  chatwoot_conversation_id bigint,
  chatwoot_message_id bigint,
  respondido_em timestamptz,
  botao_clicado text,
  crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  valor_venda numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_mkt_envios_normalized_phone ON public.mkt_envios (normalized_phone);
CREATE INDEX idx_mkt_envios_campanha ON public.mkt_envios (campanha_id, status);
CREATE INDEX idx_mkt_envios_lote ON public.mkt_envios (lote_id, status);
CREATE INDEX idx_mkt_envios_contato ON public.mkt_envios (contato_id, enviado_em DESC);
CREATE INDEX idx_mkt_envios_fila ON public.mkt_envios (agendado_para) WHERE status = 'pendente';
CREATE INDEX idx_mkt_envios_mensagem ON public.mkt_envios (chatwoot_message_id) WHERE chatwoot_message_id IS NOT NULL;
CREATE UNIQUE INDEX mkt_envios_gatilho_key ON public.mkt_envios (empresa_id, gatilho_ref) WHERE gatilho_ref IS NOT NULL;
CREATE INDEX idx_mkt_envios_lead ON public.mkt_envios (crm_lead_id);
CREATE INDEX idx_mkt_envios_quote ON public.mkt_envios (quote_id);
CREATE INDEX idx_mkt_envios_os ON public.mkt_envios (work_order_id);

CREATE TABLE public.indicacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  indicador_contato_id uuid NOT NULL REFERENCES public.mkt_contatos(id) ON DELETE CASCADE,
  indicado_contato_id uuid REFERENCES public.mkt_contatos(id) ON DELETE SET NULL,
  indicado_nome text,
  indicado_phone text NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  desconto_indicado_pct numeric(5,2) NOT NULL DEFAULT 15 CHECK (desconto_indicado_pct BETWEEN 0 AND 25),
  credito_indicador_pct numeric(5,2) NOT NULL DEFAULT 15 CHECK (credito_indicador_pct BETWEEN 0 AND 25),
  indicado_work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  indicado_usou_em timestamptz,
  indicador_usou_em timestamptz
);
CREATE UNIQUE INDEX indicacoes_indicado_key
  ON public.indicacoes (empresa_id, private.telefone_chave(indicado_phone));
CREATE INDEX idx_indicacoes_indicador ON public.indicacoes (indicador_contato_id);
CREATE INDEX idx_indicacoes_indicado ON public.indicacoes (indicado_contato_id);
CREATE INDEX idx_indicacoes_os ON public.indicacoes (indicado_work_order_id);

-- ---------------------------------------------------------------- avisos, tarefas e log
CREATE TABLE public.mkt_avisos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  titulo text NOT NULL,
  mensagem text NOT NULL,
  campanha_id uuid REFERENCES public.mkt_campanhas(id) ON DELETE CASCADE,
  lote_id uuid REFERENCES public.mkt_lotes(id) ON DELETE CASCADE,
  lido_em timestamptz,
  whatsapp_enviado_em timestamptz,
  whatsapp_erro text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_mkt_avisos_empresa ON public.mkt_avisos (empresa_id, created_at DESC);
CREATE INDEX idx_mkt_avisos_campanha ON public.mkt_avisos (campanha_id);
CREATE INDEX idx_mkt_avisos_lote ON public.mkt_avisos (lote_id);

-- Efeitos no Chatwoot pedidos pelo banco (etiqueta de opt-out, prioridade), feitos pelo servidor.
CREATE TABLE public.mkt_tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('etiqueta_optout', 'prioridade_urgente')),
  contato_id uuid REFERENCES public.mkt_contatos(id) ON DELETE CASCADE,
  conversa_id uuid REFERENCES public.conversas(id) ON DELETE CASCADE,
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'feita', 'erro')),
  tentativas int NOT NULL DEFAULT 0,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  feita_em timestamptz
);
CREATE INDEX idx_mkt_tarefas_fila ON public.mkt_tarefas (created_at) WHERE situacao = 'pendente';
CREATE INDEX idx_mkt_tarefas_empresa ON public.mkt_tarefas (empresa_id);
CREATE INDEX idx_mkt_tarefas_contato ON public.mkt_tarefas (contato_id);
CREATE INDEX idx_mkt_tarefas_conversa ON public.mkt_tarefas (conversa_id);

CREATE TABLE public.mkt_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  tipo text NOT NULL,
  resultado text NOT NULL,
  campanha_id uuid REFERENCES public.mkt_campanhas(id) ON DELETE SET NULL,
  lote_id uuid REFERENCES public.mkt_lotes(id) ON DELETE SET NULL,
  envio_id uuid REFERENCES public.mkt_envios(id) ON DELETE SET NULL,
  contato_id uuid REFERENCES public.mkt_contatos(id) ON DELETE SET NULL,
  detalhe jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_mkt_eventos_empresa ON public.mkt_eventos (empresa_id, created_at DESC);
CREATE INDEX idx_mkt_eventos_campanha ON public.mkt_eventos (campanha_id);
CREATE INDEX idx_mkt_eventos_lote ON public.mkt_eventos (lote_id);
CREATE INDEX idx_mkt_eventos_envio ON public.mkt_eventos (envio_id);
CREATE INDEX idx_mkt_eventos_contato ON public.mkt_eventos (contato_id);

-- ---------------------------------------------------------------- RLS
-- Leitura para quem é da empresa ativa; alterações só pelo servidor (funções do Nexa), exceto
-- configuração, que o admin da empresa ajusta pela tela.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mkt_configuracoes', 'mkt_contatos', 'mkt_grupos_historico', 'mkt_campanhas',
                           'mkt_lotes', 'mkt_envios', 'indicacoes', 'mkt_avisos', 'mkt_tarefas', 'mkt_eventos']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
                    USING (empresa_id = (SELECT private.empresa_ativa()))', t || '_select', t);
  END LOOP;
END $$;
GRANT INSERT, UPDATE ON public.mkt_configuracoes TO authenticated;
CREATE POLICY mkt_configuracoes_insert ON public.mkt_configuracoes FOR INSERT TO authenticated
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
CREATE POLICY mkt_configuracoes_update ON public.mkt_configuracoes FOR UPDATE TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')))
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
GRANT UPDATE (lido_em) ON public.mkt_avisos TO authenticated;
CREATE POLICY mkt_avisos_update ON public.mkt_avisos FOR UPDATE TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()))
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()));

CREATE TRIGGER trg_mkt_configuracoes_upd BEFORE UPDATE ON public.mkt_configuracoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_mkt_contatos_upd BEFORE UPDATE ON public.mkt_contatos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_mkt_campanhas_upd BEFORE UPDATE ON public.mkt_campanhas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_mkt_contatos_valida_empresa BEFORE INSERT OR UPDATE ON public.mkt_contatos
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias(
    'customer_id', 'customers', 'crm_lead_id', 'crm_leads', 'ultima_work_order_id', 'work_orders',
    'indicado_por_contato_id', 'mkt_contatos');
CREATE TRIGGER trg_mkt_grupos_historico_valida_empresa BEFORE INSERT OR UPDATE ON public.mkt_grupos_historico
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias('contato_id', 'mkt_contatos');
CREATE TRIGGER trg_mkt_campanhas_valida_empresa BEFORE INSERT OR UPDATE ON public.mkt_campanhas
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias('crm_campaign_id', 'crm_campaigns');
CREATE TRIGGER trg_mkt_lotes_valida_empresa BEFORE INSERT OR UPDATE ON public.mkt_lotes
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias('campanha_id', 'mkt_campanhas');
CREATE TRIGGER trg_mkt_envios_valida_empresa BEFORE INSERT OR UPDATE ON public.mkt_envios
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias(
    'campanha_id', 'mkt_campanhas', 'lote_id', 'mkt_lotes', 'contato_id', 'mkt_contatos',
    'crm_lead_id', 'crm_leads', 'quote_id', 'quotes', 'work_order_id', 'work_orders');
CREATE TRIGGER trg_indicacoes_valida_empresa BEFORE INSERT OR UPDATE ON public.indicacoes
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias(
    'indicador_contato_id', 'mkt_contatos', 'indicado_contato_id', 'mkt_contatos',
    'indicado_work_order_id', 'work_orders');
CREATE TRIGGER trg_mkt_avisos_valida_empresa BEFORE INSERT OR UPDATE ON public.mkt_avisos
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias(
    'campanha_id', 'mkt_campanhas', 'lote_id', 'mkt_lotes');
CREATE TRIGGER trg_mkt_tarefas_valida_empresa BEFORE INSERT OR UPDATE ON public.mkt_tarefas
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias(
    'contato_id', 'mkt_contatos', 'conversa_id', 'conversas');

-- Telefone e primeiro nome sempre calculados pelo banco.
CREATE OR REPLACE FUNCTION private.mkt_contatos_normalizar()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.normalized_phone := private.normalizar_telefone(NEW.normalized_phone);
  IF NEW.normalized_phone IS NULL OR NEW.normalized_phone !~ '^55[1-9][0-9][0-9]{8,9}$' THEN
    RAISE EXCEPTION 'mkt_contatos: telefone inválido (%)', NEW.normalized_phone USING ERRCODE = 'check_violation';
  END IF;
  NEW.nome := nullif(btrim(NEW.nome), '');
  NEW.primeiro_nome := private.mkt_primeiro_nome(NEW.nome);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.mkt_contatos_normalizar() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_mkt_contatos_normalizar BEFORE INSERT OR UPDATE OF normalized_phone, nome
  ON public.mkt_contatos FOR EACH ROW EXECUTE FUNCTION private.mkt_contatos_normalizar();

CREATE OR REPLACE FUNCTION private.indicacoes_normalizar()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.indicado_phone := private.normalizar_telefone(NEW.indicado_phone);
  IF NEW.indicado_phone IS NULL OR NEW.indicado_phone !~ '^55[1-9][0-9][0-9]{8,9}$' THEN
    RAISE EXCEPTION 'indicação: telefone do indicado inválido' USING ERRCODE = 'check_violation';
  END IF;
  NEW.indicado_nome := nullif(btrim(NEW.indicado_nome), '');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.indicacoes_normalizar() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_indicacoes_normalizar BEFORE INSERT OR UPDATE OF indicado_phone, indicado_nome
  ON public.indicacoes FOR EACH ROW EXECUTE FUNCTION private.indicacoes_normalizar();

CREATE OR REPLACE FUNCTION private.mkt_log(_empresa uuid, _tipo text, _resultado text, _detalhe jsonb DEFAULT '{}',
  _campanha uuid DEFAULT NULL, _lote uuid DEFAULT NULL, _envio uuid DEFAULT NULL, _contato uuid DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.mkt_eventos (empresa_id, tipo, resultado, detalhe, campanha_id, lote_id, envio_id, contato_id)
  VALUES (_empresa, _tipo, _resultado, coalesce(_detalhe, '{}'), _campanha, _lote, _envio, _contato);
$$;
REVOKE ALL ON FUNCTION private.mkt_log(uuid, text, text, jsonb, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.mkt_avisar(_empresa uuid, _tipo text, _titulo text, _mensagem text,
  _campanha uuid DEFAULT NULL, _lote uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE novo uuid;
BEGIN
  INSERT INTO public.mkt_avisos (empresa_id, tipo, titulo, mensagem, campanha_id, lote_id)
  VALUES (_empresa, _tipo, _titulo, _mensagem, _campanha, _lote) RETURNING id INTO novo;
  PERFORM private.mkt_log(_empresa, 'aviso', _tipo, jsonb_build_object('titulo', _titulo), _campanha, _lote);
  RETURN novo;
END $$;
REVOKE ALL ON FUNCTION private.mkt_avisar(uuid, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- base: criar/atualizar contato
-- Um contato por telefone (chave com/sem 9º dígito). Comprador nunca volta a não comprador; datas
-- ficam com a mais recente; nome só é preenchido quando estava vazio.
CREATE OR REPLACE FUNCTION private.mkt_upsert_contato(
  _emp uuid, _fone text, _nome text, _tipo text,
  _servico_em timestamptz DEFAULT NULL, _servico_tipo text DEFAULT NULL,
  _entrada_em timestamptz DEFAULT NULL, _interesse text DEFAULT NULL, _origem text DEFAULT NULL,
  _customer uuid DEFAULT NULL, _lead uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fone text := private.normalizar_telefone(_fone);
  atual public.mkt_contatos;
  tipo_servico text := CASE WHEN _servico_tipo IN ('higienizacao', 'impermeabilizacao', 'desconhecido')
                            THEN _servico_tipo ELSE private.mkt_tipo_servico(_servico_tipo) END;
BEGIN
  IF fone IS NULL OR fone !~ '^55[1-9][0-9][0-9]{8,9}$' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO atual FROM public.mkt_contatos
   WHERE empresa_id = _emp AND private.telefone_chave(normalized_phone) = private.telefone_chave(fone)
   FOR UPDATE;
  IF atual.id IS NULL THEN
    INSERT INTO public.mkt_contatos (empresa_id, nome, normalized_phone, tipo, ultimo_servico_em,
      ultimo_servico_tipo, lead_entrada_em, servico_interesse, origem_importacao, customer_id, crm_lead_id)
    VALUES (_emp, _nome, fone, _tipo, _servico_em,
      CASE WHEN _tipo = 'comprador' THEN coalesce(tipo_servico, 'desconhecido') END,
      _entrada_em, nullif(btrim(_interesse), ''), _origem, _customer, _lead)
    RETURNING * INTO atual;
    RETURN atual.id;
  END IF;
  UPDATE public.mkt_contatos SET
    nome = coalesce(nome, nullif(btrim(_nome), '')),
    tipo = CASE WHEN tipo = 'comprador' OR _tipo = 'comprador' THEN 'comprador' ELSE 'nao_comprador' END,
    ultimo_servico_tipo = CASE
      WHEN _tipo = 'comprador' AND (_servico_em IS NOT NULL AND (ultimo_servico_em IS NULL OR _servico_em >= ultimo_servico_em))
        THEN coalesce(tipo_servico, 'desconhecido')
      WHEN _tipo = 'comprador' AND ultimo_servico_tipo IS NULL THEN coalesce(tipo_servico, 'desconhecido')
      ELSE ultimo_servico_tipo END,
    ultimo_servico_em = CASE WHEN _servico_em IS NOT NULL AND (ultimo_servico_em IS NULL OR _servico_em > ultimo_servico_em)
                             THEN _servico_em ELSE ultimo_servico_em END,
    lead_entrada_em = CASE WHEN _entrada_em IS NOT NULL AND (lead_entrada_em IS NULL OR _entrada_em > lead_entrada_em)
                           THEN _entrada_em ELSE lead_entrada_em END,
    servico_interesse = coalesce(nullif(btrim(_interesse), ''), servico_interesse),
    origem_importacao = coalesce(origem_importacao, _origem),
    customer_id = coalesce(_customer, customer_id),
    crm_lead_id = coalesce(_lead, crm_lead_id)
  WHERE id = atual.id;
  RETURN atual.id;
END $$;
REVOKE ALL ON FUNCTION private.mkt_upsert_contato(uuid, text, text, text, timestamptz, text, timestamptz, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Envio de marketing recente para o telefone (resposta de campanha nos últimos N dias).
CREATE OR REPLACE FUNCTION private.mkt_envio_recente(_emp uuid, _fone text, _dias int DEFAULT 7)
RETURNS public.mkt_envios LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.* FROM public.mkt_envios e
   WHERE e.empresa_id = _emp
     AND private.telefone_chave(e.normalized_phone) = private.telefone_chave(_fone)
     AND e.status = 'enviado'
     AND e.enviado_em > now() - make_interval(days => _dias)
   ORDER BY e.enviado_em DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.mkt_envio_recente(uuid, text, int) FROM PUBLIC, anon, authenticated;

-- Lead novo (ou telefone trocado) entra como não comprador. Se ele veio de um disparo recente,
-- só liga o lead: a data de entrada não muda (senão o próprio disparo mudaria o grupo).
CREATE OR REPLACE FUNCTION private.mkt_lead_na_base()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  recente public.mkt_envios;
BEGIN
  IF NEW.normalized_phone IS NULL OR NEW.normalized_phone = '' THEN
    RETURN NEW;
  END IF;
  recente := private.mkt_envio_recente(NEW.empresa_id, NEW.normalized_phone, 7);
  IF recente.id IS NOT NULL THEN
    UPDATE public.mkt_contatos SET crm_lead_id = NEW.id WHERE id = recente.contato_id;
    RETURN NEW;
  END IF;
  PERFORM private.mkt_upsert_contato(NEW.empresa_id, NEW.normalized_phone, NEW.lead_name, 'nao_comprador',
    NULL, NULL, NEW.created_at, NEW.service_interest, 'crm', NEW.customer_id, NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.mkt_lead_na_base() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_crm_leads_mkt_insert AFTER INSERT ON public.crm_leads
  FOR EACH ROW WHEN (NEW.normalized_phone IS NOT NULL)
  EXECUTE FUNCTION private.mkt_lead_na_base();
CREATE TRIGGER trg_crm_leads_mkt_telefone AFTER UPDATE OF normalized_phone ON public.crm_leads
  FOR EACH ROW WHEN (NEW.normalized_phone IS DISTINCT FROM OLD.normalized_phone AND NEW.normalized_phone IS NOT NULL)
  EXECUTE FUNCTION private.mkt_lead_na_base();

-- OS concluída e paga → comprador (último serviço, tipo, pós-venda). OS paga → venda ligada ao
-- envio mais recente do contato (até 30 dias antes) e indicação usada.
CREATE OR REPLACE FUNCTION private.mkt_os_atualizada(_wo uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w public.work_orders;
  concluida timestamptz;
  servico text;
  paga timestamptz;
  fone text;
  contato uuid;
  envio public.mkt_envios;
  lead public.crm_leads;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = _wo;
  IF w.id IS NULL OR w.deleted_at IS NOT NULL OR w.status = 'Cancelada' THEN
    RETURN;
  END IF;

  SELECT (v.completion_date + coalesce(v.completion_time, time '12:00')) AT TIME ZONE 'America/Sao_Paulo',
         private.mkt_tipo_servico(o.name)
    INTO concluida, servico
    FROM public.visits v LEFT JOIN public.config_options o ON o.id = v.service_type_id
   WHERE v.work_order_id = w.id AND v.status = 'Concluído' AND v.completion_date IS NOT NULL
   ORDER BY v.completion_date DESC, v.completion_time DESC NULLS LAST
   LIMIT 1;
  SELECT min((p.payment_date + time '12:00') AT TIME ZONE 'America/Sao_Paulo') INTO paga
    FROM public.payments p
   WHERE p.work_order_id = w.id AND p.is_active AND p.payment_status = 'Pago' AND p.payment_date IS NOT NULL;

  SELECT * INTO lead FROM public.crm_leads WHERE linked_work_order_id = w.id ORDER BY created_at DESC LIMIT 1;
  FOR fone IN
    SELECT DISTINCT ON (private.telefone_chave(f)) f FROM (
      SELECT private.normalizar_telefone(c.phone) AS f FROM public.customers c WHERE c.id = w.customer_id
      UNION ALL SELECT lead.normalized_phone
    ) t WHERE f ~ '^55[1-9][0-9][0-9]{8,9}$'
  LOOP
    IF concluida IS NOT NULL AND paga IS NOT NULL THEN
      contato := private.mkt_upsert_contato(w.empresa_id, fone,
        (SELECT full_name FROM public.customers WHERE id = w.customer_id), 'comprador',
        concluida, coalesce(servico, 'desconhecido'), NULL, NULL, 'os', w.customer_id, lead.id);
      UPDATE public.mkt_contatos
         SET ultima_work_order_id = w.id, pos_venda_em = greatest(concluida, paga)
       WHERE id = contato AND (ultimo_servico_em IS NULL OR ultimo_servico_em <= concluida)
         AND ultima_work_order_id IS DISTINCT FROM w.id;
    END IF;

    IF paga IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mkt_envios WHERE work_order_id = w.id) THEN
      SELECT e.* INTO envio FROM public.mkt_envios e
       WHERE e.empresa_id = w.empresa_id
         AND private.telefone_chave(e.normalized_phone) = private.telefone_chave(fone)
         AND e.status = 'enviado' AND e.work_order_id IS NULL
         AND e.enviado_em BETWEEN paga - interval '30 days' AND paga + interval '1 day'
       ORDER BY e.enviado_em DESC LIMIT 1;
      IF envio.id IS NOT NULL THEN
        UPDATE public.mkt_envios SET work_order_id = w.id, valor_venda = w.total_gross_value WHERE id = envio.id;
        PERFORM private.mkt_log(w.empresa_id, 'venda', 'atribuida',
          jsonb_build_object('work_order_id', w.id, 'valor', w.total_gross_value),
          envio.campanha_id, envio.lote_id, envio.id, envio.contato_id);
      END IF;
    END IF;

    -- Indicação: o indicado comprou → crédito para quem indicou.
    IF paga IS NOT NULL THEN
      WITH usada AS (
        UPDATE public.indicacoes i SET indicado_work_order_id = w.id, indicado_usou_em = paga
         WHERE i.empresa_id = w.empresa_id AND i.indicado_work_order_id IS NULL
           AND private.telefone_chave(i.indicado_phone) = private.telefone_chave(fone)
        RETURNING i.indicador_contato_id, i.credito_indicador_pct
      )
      UPDATE public.mkt_contatos c SET credito_indicacao_pct = greatest(c.credito_indicacao_pct, u.credito_indicador_pct)
        FROM usada u WHERE c.id = u.indicador_contato_id;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.mkt_os_atualizada(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.mkt_os_gatilho()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM private.mkt_os_atualizada(NEW.work_order_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.mkt_os_gatilho() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_visits_mkt AFTER INSERT OR UPDATE OF status, completion_date, completion_time ON public.visits
  FOR EACH ROW EXECUTE FUNCTION private.mkt_os_gatilho();
CREATE TRIGGER trg_payments_mkt AFTER INSERT OR UPDATE OF payment_status, is_active, payment_date ON public.payments
  FOR EACH ROW EXECUTE FUNCTION private.mkt_os_gatilho();

-- Orçamento feito para quem recebeu disparo (até 30 dias): liga ao envio.
CREATE OR REPLACE FUNCTION private.mkt_orcamento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fone text;
  envio uuid;
BEGIN
  fone := coalesce(
    (SELECT normalized_phone FROM public.crm_leads WHERE id = NEW.crm_lead_id),
    private.normalizar_telefone(NEW.cliente_telefone));
  IF fone IS NULL THEN RETURN NEW; END IF;
  SELECT e.id INTO envio FROM public.mkt_envios e
   WHERE e.empresa_id = NEW.empresa_id AND e.status = 'enviado' AND e.quote_id IS NULL
     AND private.telefone_chave(e.normalized_phone) = private.telefone_chave(fone)
     AND e.enviado_em > now() - interval '30 days'
   ORDER BY e.enviado_em DESC LIMIT 1;
  IF envio IS NOT NULL THEN
    UPDATE public.mkt_envios SET quote_id = NEW.id WHERE id = envio;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.mkt_orcamento() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_quotes_mkt AFTER INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION private.mkt_orcamento();

-- Liga contatos a clientes e leads existentes e traz o histórico do próprio Nexa (OS pagas e
-- concluídas → compradores; leads → não compradores).
CREATE OR REPLACE FUNCTION public.mkt_sincronizar_base(_emp uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  wo uuid;
  l record;
  n_os int := 0;
  n_leads int := 0;
BEGIN
  FOR wo IN
    SELECT DISTINCT w.id FROM public.work_orders w
      JOIN public.payments p ON p.work_order_id = w.id AND p.is_active AND p.payment_status = 'Pago'
     WHERE w.empresa_id = _emp AND w.deleted_at IS NULL
  LOOP
    PERFORM private.mkt_os_atualizada(wo);
    n_os := n_os + 1;
  END LOOP;
  FOR l IN SELECT * FROM public.crm_leads WHERE empresa_id = _emp AND normalized_phone IS NOT NULL LOOP
    PERFORM private.mkt_upsert_contato(_emp, l.normalized_phone, l.lead_name, 'nao_comprador',
      NULL, NULL, l.created_at, l.service_interest, 'crm', l.customer_id, NULL);
    n_leads := n_leads + 1;
  END LOOP;
  UPDATE public.mkt_contatos c SET customer_id = x.id
    FROM (SELECT DISTINCT ON (private.telefone_chave(private.normalizar_telefone(phone)))
                 id, private.telefone_chave(private.normalizar_telefone(phone)) AS chave
            FROM public.customers WHERE empresa_id = _emp AND phone IS NOT NULL
           ORDER BY private.telefone_chave(private.normalizar_telefone(phone)), created_at DESC) x
   WHERE c.empresa_id = _emp AND c.customer_id IS NULL AND private.telefone_chave(c.normalized_phone) = x.chave;
  UPDATE public.mkt_contatos c SET crm_lead_id = x.id
    FROM (SELECT DISTINCT ON (private.telefone_chave(normalized_phone)) id,
                 private.telefone_chave(normalized_phone) AS chave
            FROM public.crm_leads WHERE empresa_id = _emp AND normalized_phone IS NOT NULL
           ORDER BY private.telefone_chave(normalized_phone), created_at DESC) x
   WHERE c.empresa_id = _emp AND c.crm_lead_id IS NULL AND private.telefone_chave(c.normalized_phone) = x.chave;
  PERFORM private.mkt_log(_emp, 'base', 'sincronizada', jsonb_build_object('os', n_os, 'leads', n_leads));
  RETURN jsonb_build_object('os', n_os, 'leads', n_leads);
END $$;
REVOKE ALL ON FUNCTION public.mkt_sincronizar_base(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_sincronizar_base(uuid) TO service_role;

-- Importação (CSV/XLSX lidos no navegador). Cada linha: telefone, nome, tipo ('comprador' |
-- 'nao_comprador'), servico_em, servico_tipo, entrada_em, interesse. Telefone repetido: fica um
-- contato; comprador vence não comprador.
CREATE OR REPLACE FUNCTION public.mkt_importar_contatos(_emp uuid, _linhas jsonb, _origem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r jsonb;
  fone text;
  v_tipo text;
  existia boolean;
  lidas int := 0;
  novos int := 0;
  atualizados int := 0;
  invalidas int := 0;
  exemplos_invalidos jsonb := '[]';
BEGIN
  IF jsonb_typeof(_linhas) <> 'array' THEN
    RAISE EXCEPTION 'linhas inválidas';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(_linhas) LOOP
    lidas := lidas + 1;
    fone := private.normalizar_telefone(r->>'telefone');
    v_tipo := CASE WHEN r->>'tipo' = 'comprador' THEN 'comprador' ELSE 'nao_comprador' END;
    IF fone IS NULL OR fone !~ '^55[1-9][0-9][0-9]{8,9}$' THEN
      invalidas := invalidas + 1;
      IF jsonb_array_length(exemplos_invalidos) < 10 THEN
        exemplos_invalidos := exemplos_invalidos || to_jsonb(left(coalesce(r->>'telefone', ''), 40));
      END IF;
      CONTINUE;
    END IF;
    existia := EXISTS (SELECT 1 FROM public.mkt_contatos WHERE empresa_id = _emp
                        AND private.telefone_chave(normalized_phone) = private.telefone_chave(fone));
    PERFORM private.mkt_upsert_contato(_emp, fone, left(r->>'nome', 120), v_tipo,
      (nullif(r->>'servico_em', '')::date + time '12:00') AT TIME ZONE 'America/Sao_Paulo',
      CASE WHEN v_tipo = 'comprador' THEN coalesce(r->>'servico_tipo', 'desconhecido') END,
      (nullif(r->>'entrada_em', '')::date + time '12:00') AT TIME ZONE 'America/Sao_Paulo',
      left(r->>'interesse', 120), left(_origem, 120));
    IF existia THEN atualizados := atualizados + 1; ELSE novos := novos + 1; END IF;
  END LOOP;
  PERFORM public.mkt_sincronizar_base(_emp);
  PERFORM private.mkt_log(_emp, 'importacao', 'concluida', jsonb_build_object(
    'origem', _origem, 'lidas', lidas, 'novos', novos, 'atualizados', atualizados, 'invalidas', invalidas));
  RETURN jsonb_build_object('lidas', lidas, 'novos', novos, 'atualizados', atualizados,
    'invalidas', invalidas, 'exemplos_invalidos', exemplos_invalidos,
    'compradores', (SELECT count(*) FROM public.mkt_contatos WHERE empresa_id = _emp AND tipo = 'comprador'),
    'nao_compradores', (SELECT count(*) FROM public.mkt_contatos WHERE empresa_id = _emp AND tipo = 'nao_comprador'));
END $$;
REVOKE ALL ON FUNCTION public.mkt_importar_contatos(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_importar_contatos(uuid, jsonb, text) TO service_role;

-- ---------------------------------------------------------------- configuração padrão
CREATE OR REPLACE FUNCTION private.mkt_config(_emp uuid)
RETURNS public.mkt_configuracoes LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cfg public.mkt_configuracoes;
BEGIN
  SELECT * INTO cfg FROM public.mkt_configuracoes WHERE empresa_id = _emp;
  IF cfg.empresa_id IS NULL THEN
    INSERT INTO public.mkt_configuracoes (empresa_id) VALUES (_emp)
    ON CONFLICT (empresa_id) DO NOTHING;
    SELECT * INTO cfg FROM public.mkt_configuracoes WHERE empresa_id = _emp;
  END IF;
  RETURN cfg;
END $$;
REVOKE ALL ON FUNCTION private.mkt_config(uuid) FROM PUBLIC, anon, authenticated;

-- Origem de venda "WhatsApp campanha" (criada na primeira resposta de campanha).
CREATE OR REPLACE FUNCTION private.mkt_origem_campanha(_emp uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE origem uuid;
BEGIN
  SELECT id INTO origem FROM public.config_options
   WHERE empresa_id = _emp AND kind = 'sales_origin' AND name = 'WhatsApp campanha' LIMIT 1;
  IF origem IS NULL THEN
    INSERT INTO public.config_options (empresa_id, kind, name, display_order, metadata)
    VALUES (_emp, 'sales_origin', 'WhatsApp campanha', 90,
            '{"codigo": "whatsapp_campanha", "palavras": []}')
    RETURNING id INTO origem;
  END IF;
  RETURN origem;
END $$;
REVOKE ALL ON FUNCTION private.mkt_origem_campanha(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- motor de grupos
-- Um grupo por contato por mês. Prioridade C1 > C3 > C2 > C4 > C5 > N1 > N2 > N3.
-- Fora de grupo: opt-out; sem pós-venda (grupos C); lead em negociação; marketing nos últimos
-- 30 dias; recusou o mesmo grupo ("Agora não" / "Já resolvi") nos últimos 120 dias.
CREATE OR REPLACE FUNCTION public.mkt_calcular_grupos(_emp uuid, _hoje date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hoje date := coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  mes date := date_trunc('month', coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date))::date;
  ref timestamptz := (coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp) AT TIME ZONE 'America/Sao_Paulo';
  ini_mes timestamptz;
  fim_mes timestamptz;
  resultado jsonb;
BEGIN
  ini_mes := (mes::timestamp) AT TIME ZONE 'America/Sao_Paulo';
  fim_mes := ((mes + interval '1 month')::timestamp) AT TIME ZONE 'America/Sao_Paulo';

  CREATE TEMP TABLE IF NOT EXISTS mkt_calc (id uuid PRIMARY KEY, grupo text, motivo text) ON COMMIT DROP;
  DELETE FROM mkt_calc;
  INSERT INTO mkt_calc (id, grupo, motivo)
  SELECT c.id,
    CASE WHEN fora IS NOT NULL THEN NULL ELSE g END,
    coalesce(fora, CASE WHEN g IS NULL THEN 'sem grupo pela data' END)
  FROM public.mkt_contatos c
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN c.tipo = 'comprador' THEN CASE
        WHEN c.ultimo_servico_em IS NULL THEN 'C5'
        WHEN c.ultimo_servico_em > ref - interval '30 days' THEN 'C1'
        WHEN c.ultimo_servico_tipo = 'impermeabilizacao'
         AND c.ultimo_servico_em + interval '1 year 15 days' < fim_mes
         AND c.ultimo_servico_em + interval '1 year 1 month' >= ini_mes THEN 'C3'
        WHEN c.ultimo_servico_tipo = 'higienizacao'
         AND c.ultimo_servico_em BETWEEN ref - interval '7 months' AND ref - interval '5 months' THEN 'C2'
        WHEN c.ultimo_servico_em BETWEEN ref - interval '12 months' AND ref - interval '3 months' THEN 'C4'
        WHEN c.ultimo_servico_em < ref - interval '12 months' THEN 'C5'
      END
      ELSE CASE
        WHEN c.lead_entrada_em IS NULL THEN 'N3'
        WHEN c.lead_entrada_em >= ref - interval '3 months' THEN 'N1'
        WHEN c.lead_entrada_em >= ref - interval '9 months' THEN 'N2'
        WHEN c.lead_entrada_em < ref - interval '12 months' THEN 'N3'
      END
    END AS g
  ) calc
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN c.optout_em IS NOT NULL THEN 'opt-out'
      WHEN c.tipo = 'comprador' AND c.sem_pos_venda THEN 'sem pós-venda'
      WHEN EXISTS (SELECT 1 FROM public.mkt_envios e JOIN public.mkt_campanhas k ON k.id = e.campanha_id
                    WHERE e.contato_id = c.id AND e.status = 'enviado'
                      AND e.enviado_em > now() - interval '30 days'
                      AND k.gatilho IS DISTINCT FROM 'C1') THEN 'marketing nos últimos 30 dias'
      WHEN EXISTS (SELECT 1 FROM public.crm_leads l JOIN public.config_options s ON s.id = l.status_id
                    WHERE l.empresa_id = c.empresa_id AND l.is_open
                      AND private.telefone_chave(l.normalized_phone) = private.telefone_chave(c.normalized_phone)
                      AND s.metadata->>'stage' IN ('negociacao', 'orcamento', 'aguardando')) THEN 'em negociação'
      WHEN calc.g IS NOT NULL AND calc.g = c.recusou_grupo AND c.recusou_em > now() - interval '120 days'
        THEN 'recusou este grupo'
    END AS fora
  ) excl
  WHERE c.empresa_id = _emp;

  UPDATE public.mkt_contatos c SET grupo_atual = k.grupo, grupo_calculado_em = now()
    FROM mkt_calc k WHERE c.id = k.id;
  INSERT INTO public.mkt_grupos_historico (empresa_id, contato_id, mes_ref, grupo, motivo_fora, calculado_em)
  SELECT _emp, id, mes, grupo, motivo, now() FROM mkt_calc
  ON CONFLICT (contato_id, mes_ref) DO UPDATE
    SET grupo = EXCLUDED.grupo, motivo_fora = EXCLUDED.motivo_fora, calculado_em = now();

  SELECT jsonb_build_object(
           'mes', mes,
           'total', (SELECT count(*) FROM mkt_calc),
           'grupos', coalesce((SELECT jsonb_object_agg(grupo, n)
                                 FROM (SELECT grupo, count(*) AS n FROM mkt_calc
                                        WHERE grupo IS NOT NULL GROUP BY grupo) g), '{}'),
           'fora', (SELECT count(*) FROM mkt_calc WHERE grupo IS NULL))
    INTO resultado;
  PERFORM private.mkt_log(_emp, 'grupos', 'calculados', resultado);
  RETURN resultado;
END $$;
REVOKE ALL ON FUNCTION public.mkt_calcular_grupos(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_calcular_grupos(uuid, date) TO service_role;

-- ---------------------------------------------------------------- campanhas do calendário
CREATE OR REPLACE FUNCTION private.mkt_template_padrao(_grupo text, _mes date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE _grupo
    WHEN 'C4' THEN 'tc_oferta_trimestral'
    WHEN 'C5' THEN 'tc_reativacao_cliente'
    WHEN 'N1' THEN 'tc_orcamento_retomada'
    WHEN 'C2' THEN 'tc_higienizacao_6meses'
    WHEN 'C3' THEN 'tc_imper_13meses'
    ELSE 'tc_sazonal_' || (ARRAY['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'])
                           [extract(month FROM _mes)::int]
  END;
$$;
REVOKE ALL ON FUNCTION private.mkt_template_padrao(text, date) FROM PUBLIC, anon, authenticated;

-- Próxima terça, quarta ou quinta a partir de _data (inclusive).
CREATE OR REPLACE FUNCTION private.mkt_proximo_dia_util(_data date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT min(d)::date FROM generate_series(_data, _data + 7, interval '1 day') d
   WHERE extract(isodow FROM d) IN (2, 3, 4);
$$;
REVOKE ALL ON FUNCTION private.mkt_proximo_dia_util(date) FROM PUBLIC, anon, authenticated;

-- Monta os lotes da campanha (recalcula os grupos antes). Só antes da aprovação.
-- Compradores primeiro; lotes de até lote_tamanho, um por dia de disparo (terça a quinta);
-- se não couber nas datas do calendário, usa as próximas terças a quintas.
CREATE OR REPLACE FUNCTION public.mkt_preparar_campanha(_campanha uuid, _hoje date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hoje date := coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  c public.mkt_campanhas;
  cfg public.mkt_configuracoes;
  datas date[];
  d date;
  total int;
  n_lotes int;
  i int;
  v_estimativa jsonb;
BEGIN
  SELECT * INTO c FROM public.mkt_campanhas WHERE id = _campanha FOR UPDATE;
  IF c.id IS NULL OR c.tipo <> 'calendario' THEN
    RAISE EXCEPTION 'Campanha não encontrada.';
  END IF;
  IF c.status NOT IN ('rascunho', 'aguardando_aprovacao', 'bloqueada') THEN
    RAISE EXCEPTION 'A campanha já foi %; não dá para preparar de novo.', c.status;
  END IF;
  cfg := private.mkt_config(c.empresa_id);
  PERFORM public.mkt_calcular_grupos(c.empresa_id, hoje);

  DELETE FROM public.mkt_envios WHERE campanha_id = c.id;
  DELETE FROM public.mkt_lotes WHERE campanha_id = c.id;

  CREATE TEMP TABLE IF NOT EXISTS mkt_sel (
    ordem int, contato_id uuid, normalized_phone text, grupo text, template text, sn boolean
  ) ON COMMIT DROP;
  DELETE FROM mkt_sel;
  INSERT INTO mkt_sel (ordem, contato_id, normalized_phone, grupo, template, sn)
  SELECT row_number() OVER (ORDER BY x.prioridade, x.pos_grupo) - 1,
         x.id, x.normalized_phone, x.grupo_atual,
         coalesce(c.templates->>x.grupo_atual, private.mkt_template_padrao(x.grupo_atual, c.mes_ref))
           || CASE WHEN x.primeiro_nome IS NULL THEN '_sn' ELSE '' END,
         x.primeiro_nome IS NULL
    FROM (
      SELECT k.*, array_position(ARRAY['C1', 'C3', 'C2', 'C4', 'C5', 'N1', 'N2', 'N3'], k.grupo_atual) AS prioridade,
             row_number() OVER (PARTITION BY k.grupo_atual
                                ORDER BY k.ultimo_servico_em DESC NULLS LAST, k.lead_entrada_em DESC NULLS LAST,
                                         k.normalized_phone) AS pos_grupo
        FROM public.mkt_contatos k
       WHERE k.empresa_id = c.empresa_id
         AND k.grupo_atual = ANY (c.grupos)
         AND k.optout_em IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.mkt_envios e JOIN public.mkt_campanhas o ON o.id = e.campanha_id
                          WHERE e.contato_id = k.id AND o.id <> c.id
                            AND e.status IN ('pendente', 'manual', 'enviando')
                            AND o.status IN ('aguardando_aprovacao', 'aprovada', 'enviando', 'pausada'))
    ) x
   WHERE x.pos_grupo <= coalesce((c.limites->>x.grupo_atual)::int, 1000000);

  SELECT count(*) INTO total FROM mkt_sel;
  n_lotes := greatest(1, ceil(total::numeric / cfg.lote_tamanho)::int);

  -- Datas: as do calendário que caem de terça a quinta, a partir de amanhã; faltando, as seguintes.
  SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO datas
    FROM (SELECT DISTINCT unnest(c.datas_disparo) AS x) t
   WHERE extract(isodow FROM x) IN (2, 3, 4) AND x > hoje;
  d := coalesce((SELECT max(x) FROM unnest(datas) x), hoje);
  WHILE coalesce(array_length(datas, 1), 0) < n_lotes LOOP
    d := private.mkt_proximo_dia_util(d + 1);
    datas := datas || d;
  END LOOP;

  FOR i IN 1..n_lotes LOOP
    INSERT INTO public.mkt_lotes (empresa_id, campanha_id, numero, etiqueta_chatwoot, data_prevista, quantidade)
    VALUES (c.empresa_id, c.id, i, 'camp-' || to_char(c.mes_ref, 'YYYY-MM') || '-l' || i, datas[i],
            (SELECT count(*) FROM mkt_sel WHERE ordem / cfg.lote_tamanho = i - 1));
  END LOOP;
  INSERT INTO public.mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo,
    template_nome, variante_sn, ordem)
  SELECT c.empresa_id, c.id, l.id, s.contato_id, s.normalized_phone, s.grupo, s.template, s.sn,
         s.ordem % cfg.lote_tamanho
    FROM mkt_sel s JOIN public.mkt_lotes l ON l.campanha_id = c.id AND l.numero = s.ordem / cfg.lote_tamanho + 1;

  SELECT jsonb_build_object(
      'total', total,
      'por_grupo', coalesce((SELECT jsonb_object_agg(grupo, n) FROM (SELECT grupo, count(*) n FROM mkt_sel GROUP BY grupo) g), '{}'),
      'por_modelo', coalesce((SELECT jsonb_object_agg(template, n) FROM (SELECT template, count(*) n FROM mkt_sel GROUP BY template) m), '{}'),
      'sem_nome', (SELECT count(*) FROM mkt_sel WHERE sn),
      'custo', round(total * c.custo_msg_estimado, 2),
      'lotes', n_lotes,
      'datas', to_jsonb(datas[1:n_lotes]))
    INTO v_estimativa;

  IF c.crm_campaign_id IS NULL THEN
    INSERT INTO public.crm_campaigns (empresa_id, platform, campaign_name, advertised_service, active)
    VALUES (c.empresa_id, 'WhatsApp', c.nome, c.tema, true) RETURNING id INTO c.crm_campaign_id;
  END IF;
  UPDATE public.mkt_campanhas
     SET status = 'aguardando_aprovacao', motivo_status = NULL, preparada_em = now(),
         estimativa = v_estimativa, crm_campaign_id = c.crm_campaign_id
   WHERE id = c.id;
  PERFORM private.mkt_log(c.empresa_id, 'campanha', 'preparada', v_estimativa, c.id);
  RETURN v_estimativa;
END $$;
REVOKE ALL ON FUNCTION public.mkt_preparar_campanha(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_preparar_campanha(uuid, date) TO service_role;

-- Aprovação: agenda cada envio (dia do lote, hora do disparo + posição × intervalo).
-- Só até a véspera do primeiro disparo.
CREATE OR REPLACE FUNCTION public.mkt_aprovar_campanha(_campanha uuid, _usuario uuid, _hoje date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hoje date := coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  c public.mkt_campanhas;
  cfg public.mkt_configuracoes;
  primeira date;
BEGIN
  SELECT * INTO c FROM public.mkt_campanhas WHERE id = _campanha FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Campanha não encontrada.'; END IF;
  IF c.status <> 'aguardando_aprovacao' THEN
    RAISE EXCEPTION 'Só dá para aprovar campanha aguardando aprovação (está %).', c.status;
  END IF;
  SELECT min(data_prevista) INTO primeira FROM public.mkt_lotes WHERE campanha_id = c.id;
  IF primeira IS NULL OR primeira <= hoje THEN
    RAISE EXCEPTION 'O prazo de aprovação acabou (véspera do primeiro disparo).';
  END IF;
  cfg := private.mkt_config(c.empresa_id);
  UPDATE public.mkt_envios e
     SET agendado_para = ((l.data_prevista + make_time(cfg.hora_disparo, 0, 0))::timestamp AT TIME ZONE 'America/Sao_Paulo')
                         + make_interval(secs => e.ordem * cfg.intervalo_segundos)
    FROM public.mkt_lotes l
   WHERE l.id = e.lote_id AND e.campanha_id = c.id AND e.status = 'pendente';
  UPDATE public.mkt_lotes SET status = 'aprovado' WHERE campanha_id = c.id AND status = 'preparado';
  UPDATE public.mkt_campanhas SET status = 'aprovada', aprovada_em = now(), aprovada_por = _usuario,
         motivo_status = NULL WHERE id = c.id;
  PERFORM private.mkt_log(c.empresa_id, 'campanha', 'aprovada', jsonb_build_object('usuario', _usuario), c.id);
  RETURN jsonb_build_object('status', 'aprovada', 'primeiro_disparo', primeira);
END $$;
REVOKE ALL ON FUNCTION public.mkt_aprovar_campanha(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_aprovar_campanha(uuid, uuid, date) TO service_role;

-- Recusa, expiração e bloqueio: nada é enviado.
CREATE OR REPLACE FUNCTION public.mkt_encerrar_campanha(_campanha uuid, _status text, _motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.mkt_campanhas;
BEGIN
  IF _status NOT IN ('recusada', 'expirada', 'bloqueada') THEN
    RAISE EXCEPTION 'situação inválida';
  END IF;
  SELECT * INTO c FROM public.mkt_campanhas WHERE id = _campanha FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Campanha não encontrada.'; END IF;
  IF c.status IN ('enviando', 'concluida') OR (c.status IN ('aprovada', 'pausada') AND _status <> 'bloqueada') THEN
    RAISE EXCEPTION 'A campanha está %; use Pausar.', c.status;
  END IF;
  -- Bloqueada continua com os lotes (pode ser preparada de novo quando o modelo for aprovado).
  IF _status <> 'bloqueada' THEN
    UPDATE public.mkt_envios SET status = 'cancelado', erro = _motivo
     WHERE campanha_id = c.id AND status IN ('pendente', 'manual');
    UPDATE public.mkt_lotes SET status = 'cancelado' WHERE campanha_id = c.id AND status IN ('preparado', 'aprovado');
  ELSE
    UPDATE public.mkt_lotes SET status = 'preparado' WHERE campanha_id = c.id AND status = 'aprovado';
  END IF;
  UPDATE public.mkt_campanhas
     SET status = _status, motivo_status = _motivo,
         recusada_em = CASE WHEN _status = 'recusada' THEN now() ELSE recusada_em END
   WHERE id = c.id;
  PERFORM private.mkt_log(c.empresa_id, 'campanha', _status, jsonb_build_object('motivo', _motivo), c.id);
END $$;
REVOKE ALL ON FUNCTION public.mkt_encerrar_campanha(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_encerrar_campanha(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------- travas e pausa
-- Pausa sozinho o lote se, depois da amostra mínima, os erros passarem de limite_erro_pct ou
-- opt-out + bloqueio passarem de limite_optout_pct dos envios tentados.
CREATE OR REPLACE FUNCTION private.mkt_checar_lote(_lote uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.mkt_lotes;
  k public.mkt_campanhas;
  cfg public.mkt_configuracoes;
  tent int;
  erros int;
  bloq int;
  opt int;
  motivo text;
BEGIN
  SELECT * INTO l FROM public.mkt_lotes WHERE id = _lote FOR UPDATE;
  IF l.id IS NULL THEN RETURN false; END IF;
  SELECT * INTO k FROM public.mkt_campanhas WHERE id = l.campanha_id;
  cfg := private.mkt_config(l.empresa_id);
  SELECT count(*) FILTER (WHERE e.status IN ('enviado', 'erro')),
         count(*) FILTER (WHERE e.status = 'erro'),
         count(*) FILTER (WHERE e.bloqueio),
         count(*) FILTER (WHERE c.optout_em IS NOT NULL AND e.enviado_em IS NOT NULL AND c.optout_em >= e.enviado_em)
    INTO tent, erros, bloq, opt
    FROM public.mkt_envios e JOIN public.mkt_contatos c ON c.id = e.contato_id
   WHERE e.lote_id = l.id
     AND coalesce(e.reservado_em, e.enviado_em, e.created_at) > coalesce(l.retomado_em, '-infinity');

  IF l.status IN ('aprovado', 'enviando') AND tent >= cfg.amostra_minima THEN
    IF erros * 100.0 / tent > cfg.limite_erro_pct THEN
      motivo := format('erros de envio em %s%% (%s de %s)', round(erros * 100.0 / tent, 1), erros, tent);
    ELSIF (opt + bloq) * 100.0 / tent > cfg.limite_optout_pct THEN
      motivo := format('opt-out + bloqueio em %s%% (%s de %s)', round((opt + bloq) * 100.0 / tent, 1), opt + bloq, tent);
    END IF;
    IF motivo IS NOT NULL THEN
      UPDATE public.mkt_lotes SET status = 'pausado', motivo_pausa = 'pausa automática: ' || motivo WHERE id = l.id;
      IF k.tipo = 'calendario' THEN
        UPDATE public.mkt_campanhas SET status = 'pausada', motivo_status = 'pausa automática: ' || motivo WHERE id = k.id;
      END IF;
      PERFORM private.mkt_avisar(l.empresa_id, 'pausa_automatica', 'Disparo pausado sozinho',
        format('A campanha "%s" (lote %s) foi pausada: %s. Confira antes de retomar.', k.nome, l.numero, motivo),
        k.id, l.id);
      RETURN true;
    END IF;
  END IF;

  -- Lote terminou.
  IF l.status IN ('aprovado', 'enviando')
     AND NOT EXISTS (SELECT 1 FROM public.mkt_envios WHERE lote_id = l.id AND status IN ('pendente', 'enviando'))
     AND EXISTS (SELECT 1 FROM public.mkt_envios WHERE lote_id = l.id AND status IN ('enviado', 'erro')) THEN
    UPDATE public.mkt_lotes SET status = 'concluido', concluido_em = now() WHERE id = l.id;
    PERFORM private.mkt_log(l.empresa_id, 'lote', 'concluido',
      jsonb_build_object('tentativas', tent, 'erros', erros, 'optout', opt, 'bloqueios', bloq), k.id, l.id);
    IF k.tipo = 'calendario' AND NOT EXISTS (SELECT 1 FROM public.mkt_lotes
                                             WHERE campanha_id = k.id AND status NOT IN ('concluido', 'cancelado')) THEN
      UPDATE public.mkt_campanhas SET status = 'concluida' WHERE id = k.id;
      PERFORM private.mkt_avisar(k.empresa_id, 'campanha_concluida', 'Campanha concluída',
        format('A campanha "%s" terminou de sair. Veja respostas e vendas no relatório.', k.nome), k.id);
    END IF;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION private.mkt_checar_lote(uuid) FROM PUBLIC, anon, authenticated;

-- Próximo horário permitido para o calendário (terça a quinta, entre hora_disparo e hora_limite).
CREATE OR REPLACE FUNCTION private.mkt_proximo_horario(_emp uuid, _desde timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.mkt_configuracoes := private.mkt_config(_emp);
  local timestamp := _desde AT TIME ZONE 'America/Sao_Paulo';
  dia date := local::date;
BEGIN
  IF extract(isodow FROM dia) IN (2, 3, 4) AND extract(hour FROM local) < cfg.hora_limite THEN
    RETURN greatest(_desde, (dia + make_time(cfg.hora_disparo, 0, 0))::timestamp AT TIME ZONE 'America/Sao_Paulo');
  END IF;
  dia := private.mkt_proximo_dia_util(dia + 1);
  RETURN (dia + make_time(cfg.hora_disparo, 0, 0))::timestamp AT TIME ZONE 'America/Sao_Paulo';
END $$;
REVOKE ALL ON FUNCTION private.mkt_proximo_horario(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- Pausar (lote ou campanha inteira): os envios pendentes ficam parados até retomar.
CREATE OR REPLACE FUNCTION public.mkt_pausar(_campanha uuid, _lote uuid, _motivo text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k public.mkt_campanhas;
  n int;
BEGIN
  SELECT * INTO k FROM public.mkt_campanhas WHERE id = _campanha FOR UPDATE;
  IF k.id IS NULL THEN RAISE EXCEPTION 'Campanha não encontrada.'; END IF;
  UPDATE public.mkt_lotes SET status = 'pausado', motivo_pausa = coalesce(_motivo, 'pausado no Nexa')
   WHERE campanha_id = k.id AND (_lote IS NULL OR id = _lote) AND status IN ('aprovado', 'enviando');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF k.tipo = 'calendario' AND k.status IN ('aprovada', 'enviando') THEN
    UPDATE public.mkt_campanhas SET status = 'pausada', motivo_status = coalesce(_motivo, 'pausada no Nexa')
     WHERE id = k.id;
  END IF;
  PERFORM private.mkt_log(k.empresa_id, 'campanha', 'pausada',
    jsonb_build_object('lote', _lote, 'lotes', n, 'motivo', _motivo), k.id, _lote);
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.mkt_pausar(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_pausar(uuid, uuid, text) TO service_role;

-- Retomar: reagenda os pendentes a partir do próximo horário permitido, espaçados.
CREATE OR REPLACE FUNCTION public.mkt_retomar(_campanha uuid, _lote uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k public.mkt_campanhas;
  cfg public.mkt_configuracoes;
  l record;
  inicio timestamptz;
  n int := 0;
BEGIN
  SELECT * INTO k FROM public.mkt_campanhas WHERE id = _campanha FOR UPDATE;
  IF k.id IS NULL THEN RAISE EXCEPTION 'Campanha não encontrada.'; END IF;
  cfg := private.mkt_config(k.empresa_id);
  FOR l IN SELECT * FROM public.mkt_lotes
            WHERE campanha_id = k.id AND (_lote IS NULL OR id = _lote) AND status = 'pausado' LOOP
    inicio := private.mkt_proximo_horario(k.empresa_id,
      greatest(now(), ((l.data_prevista + make_time(cfg.hora_disparo, 0, 0))::timestamp AT TIME ZONE 'America/Sao_Paulo')));
    -- Gatilho não segue o calendário (terça a quinta): sai no mesmo dia, das 9h à hora limite.
    IF k.tipo = 'gatilho' THEN inicio := now(); END IF;
    UPDATE public.mkt_envios e SET agendado_para = inicio + make_interval(secs => x.pos * cfg.intervalo_segundos)
      FROM (SELECT id, row_number() OVER (ORDER BY ordem) - 1 AS pos FROM public.mkt_envios
             WHERE lote_id = l.id AND status = 'pendente') x
     WHERE e.id = x.id;
    UPDATE public.mkt_lotes SET status = CASE WHEN iniciado_em IS NULL THEN 'aprovado' ELSE 'enviando' END,
           motivo_pausa = NULL, retomado_em = now() WHERE id = l.id;
    n := n + 1;
  END LOOP;
  IF k.tipo = 'calendario' AND k.status = 'pausada' THEN
    UPDATE public.mkt_campanhas
       SET status = CASE WHEN EXISTS (SELECT 1 FROM public.mkt_envios WHERE campanha_id = k.id AND enviado_em IS NOT NULL)
                         THEN 'enviando' ELSE 'aprovada' END,
           motivo_status = NULL
     WHERE id = k.id;
  END IF;
  -- Lote retomado sem nada para sair (pausou no último envio): conclui (e a campanha, se for o caso).
  FOR l IN SELECT * FROM public.mkt_lotes
            WHERE campanha_id = k.id AND (_lote IS NULL OR id = _lote) AND status = 'enviando'
              AND retomado_em IS NOT NULL LOOP
    PERFORM private.mkt_checar_lote(l.id);
  END LOOP;
  PERFORM private.mkt_log(k.empresa_id, 'campanha', 'retomada', jsonb_build_object('lotes', n), k.id, _lote);
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.mkt_retomar(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_retomar(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------- fila de disparo
-- Reserva os envios que já podem sair: flag ligada, lote e campanha liberados, horário permitido
-- (calendário: terça a quinta, hora_disparo–hora_limite; gatilhos: 9h–hora_limite; nunca 21h–8h).
CREATE OR REPLACE FUNCTION public.mkt_reservar_envios(_limite int, _agora timestamptz DEFAULT NULL)
RETURNS TABLE (
  envio_id uuid, empresa_id uuid, campanha_id uuid, lote_id uuid, contato_id uuid,
  normalized_phone text, nome text, primeiro_nome text, template_nome text, variante_sn boolean,
  idioma text, condicao_texto text, condicao_pct numeric, etiqueta text, grupo text,
  whatsapp_contact_id uuid, chatwoot_contact_id bigint, conversa_chatwoot_id bigint, conversa_status text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  agora timestamptz := coalesce(_agora, now());
  hora int := extract(hour FROM coalesce(_agora, now()) AT TIME ZONE 'America/Sao_Paulo')::int;
  dia int := extract(isodow FROM coalesce(_agora, now()) AT TIME ZONE 'America/Sao_Paulo')::int;
BEGIN
  -- Quem saiu (opt-out) depois da preparação não recebe.
  UPDATE public.mkt_envios e SET status = 'cancelado', erro = 'opt-out'
    FROM public.mkt_contatos c
   WHERE c.id = e.contato_id AND e.status IN ('pendente', 'manual') AND c.optout_em IS NOT NULL;
  -- Envio interrompido (servidor caiu no meio): não reenviar às cegas; fica como erro para conferir.
  UPDATE public.mkt_envios SET status = 'erro', erro = 'envio interrompido: confira no Chatwoot'
   WHERE status = 'enviando' AND reservado_em < now() - interval '15 minutes';

  IF hora < 8 OR hora >= 21 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH escolhidos AS (
    SELECT e.id
      FROM public.mkt_envios e
      JOIN public.mkt_lotes l ON l.id = e.lote_id
      JOIN public.mkt_campanhas k ON k.id = e.campanha_id
      JOIN public.mkt_configuracoes cfg ON cfg.empresa_id = e.empresa_id
     WHERE e.status = 'pendente' AND e.agendado_para <= agora
       AND l.status IN ('aprovado', 'enviando')
       AND hora < cfg.hora_limite
       AND ((k.tipo = 'calendario' AND k.status IN ('aprovada', 'enviando') AND cfg.disparo_ligado
             AND dia IN (2, 3, 4) AND hora >= cfg.hora_disparo)
         OR (k.tipo = 'gatilho' AND hora >= 9
             AND ((k.gatilho = 'C1' AND cfg.gatilho_c1_ligado)
               OR (k.gatilho = 'C2' AND cfg.gatilho_c2_ligado)
               OR (k.gatilho IN ('C3', 'C3L') AND cfg.gatilho_c3_ligado))))
     ORDER BY e.agendado_para
     LIMIT greatest(_limite, 0)
     FOR UPDATE OF e SKIP LOCKED
  ), reservados AS (
    UPDATE public.mkt_envios e SET status = 'enviando', reservado_em = now()
      FROM escolhidos x WHERE e.id = x.id
    RETURNING e.*
  ), lotes AS (
    UPDATE public.mkt_lotes l SET status = 'enviando', iniciado_em = coalesce(l.iniciado_em, now())
     WHERE l.id IN (SELECT r.lote_id FROM reservados r) AND l.status = 'aprovado'
    RETURNING l.id
  ), campanhas AS (
    UPDATE public.mkt_campanhas k SET status = 'enviando'
     WHERE k.id IN (SELECT r.campanha_id FROM reservados r) AND k.status = 'aprovada'
    RETURNING k.id
  )
  SELECT r.id, r.empresa_id, r.campanha_id, r.lote_id, r.contato_id, c.normalized_phone, c.nome,
         c.primeiro_nome, r.template_nome, r.variante_sn, cfg.template_idioma, k.condicao_texto,
         k.condicao_pct, l.etiqueta_chatwoot, r.grupo, w.id, w.chatwoot_contact_id,
         cv.chatwoot_conversation_id, cv.status
    FROM reservados r
    JOIN public.mkt_contatos c ON c.id = r.contato_id
    JOIN public.mkt_campanhas k ON k.id = r.campanha_id
    JOIN public.mkt_lotes l ON l.id = r.lote_id
    JOIN public.mkt_configuracoes cfg ON cfg.empresa_id = r.empresa_id
    LEFT JOIN LATERAL (
      SELECT wc.id, wc.chatwoot_contact_id FROM public.whatsapp_contacts wc
       WHERE wc.empresa_id = r.empresa_id
         AND private.telefone_chave(wc.normalized_phone) = private.telefone_chave(c.normalized_phone)
       ORDER BY wc.last_message_at DESC NULLS LAST LIMIT 1
    ) w ON true
    LEFT JOIN LATERAL (
      SELECT v.chatwoot_conversation_id, v.status FROM public.conversas v
       WHERE v.whatsapp_contact_id = w.id AND v.empresa_id = r.empresa_id
       ORDER BY v.ultima_atividade_em DESC NULLS LAST LIMIT 1
    ) cv ON true
   ORDER BY r.agendado_para;
END $$;
REVOKE ALL ON FUNCTION public.mkt_reservar_envios(int, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_reservar_envios(int, timestamptz) TO service_role;

-- Resultado de um envio (o servidor chama depois da API do Chatwoot). Devolve se pausou o lote.
CREATE OR REPLACE FUNCTION public.mkt_registrar_envio(_envio uuid, _ok boolean, _erro text,
  _conversa bigint, _mensagem bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e public.mkt_envios;
  pausou boolean;
BEGIN
  UPDATE public.mkt_envios
     SET status = CASE WHEN _ok THEN 'enviado' ELSE 'erro' END,
         enviado_em = CASE WHEN _ok THEN now() ELSE enviado_em END,
         erro = CASE WHEN _ok THEN NULL ELSE left(coalesce(_erro, 'falha no envio'), 500) END,
         bloqueio = NOT _ok AND coalesce(_erro, '') ~* '131026|131050|blocked|bloque',
         chatwoot_conversation_id = coalesce(_conversa, chatwoot_conversation_id),
         chatwoot_message_id = coalesce(_mensagem, chatwoot_message_id)
   WHERE id = _envio AND status = 'enviando'
  RETURNING * INTO e;
  IF e.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'envio não estava reservado');
  END IF;
  PERFORM private.mkt_log(e.empresa_id, 'envio', CASE WHEN _ok THEN 'enviado' ELSE 'erro' END,
    jsonb_build_object('template', e.template_nome, 'erro', e.erro, 'conversa', _conversa),
    e.campanha_id, e.lote_id, e.id, e.contato_id);
  pausou := private.mkt_checar_lote(e.lote_id);
  RETURN jsonb_build_object('ok', true, 'pausou', pausou);
END $$;
REVOKE ALL ON FUNCTION public.mkt_registrar_envio(uuid, boolean, text, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_registrar_envio(uuid, boolean, text, bigint, bigint) TO service_role;

-- Última conferência antes de cada mensagem (o servidor espaça os envios, então entre a reserva e o
-- envio alguém pode ter pausado, desligado a flag ou o contato ter saído). Se não pode sair, o envio
-- volta para a fila (ou é cancelado, no opt-out).
CREATE OR REPLACE FUNCTION public.mkt_confirmar_envio(_envio uuid, _agora timestamptz DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e public.mkt_envios;
  hora int := extract(hour FROM coalesce(_agora, now()) AT TIME ZONE 'America/Sao_Paulo')::int;
  pode boolean;
BEGIN
  SELECT * INTO e FROM public.mkt_envios WHERE id = _envio FOR UPDATE;
  IF e.id IS NULL OR e.status <> 'enviando' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.mkt_contatos WHERE id = e.contato_id AND optout_em IS NOT NULL) THEN
    UPDATE public.mkt_envios SET status = 'cancelado', erro = 'opt-out' WHERE id = e.id;
    RETURN false;
  END IF;
  SELECT l.status = 'enviando' AND hora >= 8 AND hora < 21 AND hora < cfg.hora_limite
         AND ((k.tipo = 'calendario' AND k.status = 'enviando' AND cfg.disparo_ligado)
           OR (k.tipo = 'gatilho' AND ((k.gatilho = 'C1' AND cfg.gatilho_c1_ligado)
                                    OR (k.gatilho = 'C2' AND cfg.gatilho_c2_ligado)
                                    OR (k.gatilho IN ('C3', 'C3L') AND cfg.gatilho_c3_ligado))))
    INTO pode
    FROM public.mkt_lotes l
    JOIN public.mkt_campanhas k ON k.id = l.campanha_id
    JOIN public.mkt_configuracoes cfg ON cfg.empresa_id = k.empresa_id
   WHERE l.id = e.lote_id;
  IF coalesce(pode, false) THEN RETURN true; END IF;
  UPDATE public.mkt_envios SET status = 'pendente', reservado_em = NULL WHERE id = e.id;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.mkt_confirmar_envio(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_confirmar_envio(uuid, timestamptz) TO service_role;

-- Falha de entrega informada depois pelo WhatsApp (webhook "message_updated", status failed).
CREATE OR REPLACE FUNCTION private.mkt_falha_entrega()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_erro text := left(coalesce(NEW.payload->'content_attributes'->>'external_error', 'falha na entrega'), 500);
  e public.mkt_envios;
BEGIN
  IF NEW.payload->>'status' IS DISTINCT FROM 'failed' OR NEW.payload->>'id' !~ '^[0-9]+$' THEN
    RETURN NEW;
  END IF;
  UPDATE public.mkt_envios
     SET status = 'erro', erro = v_erro, bloqueio = v_erro ~* '131026|131050|blocked|bloque'
   WHERE chatwoot_message_id = (NEW.payload->>'id')::bigint AND status = 'enviado'
  RETURNING * INTO e;
  IF e.id IS NULL THEN RETURN NEW; END IF;
  -- 131050: a pessoa parou de receber mensagens de marketing da empresa.
  IF v_erro ~ '131050' THEN
    UPDATE public.mkt_contatos SET optout_em = coalesce(optout_em, now()) WHERE id = e.contato_id;
  END IF;
  PERFORM private.mkt_log(e.empresa_id, 'envio', 'falha_entrega', jsonb_build_object('erro', v_erro),
    e.campanha_id, e.lote_id, e.id, e.contato_id);
  PERFORM private.mkt_checar_lote(e.lote_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.mkt_falha_entrega() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_integracao_eventos_mkt AFTER INSERT ON public.integracao_eventos
  FOR EACH ROW WHEN (NEW.provedor = 'chatwoot' AND NEW.evento = 'message_updated')
  EXECUTE FUNCTION private.mkt_falha_entrega();

-- ---------------------------------------------------------------- respostas e botões
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
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.mkt_resposta() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_whatsapp_messages_mkt AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW WHEN (NEW.direction = 'Recebida' AND NOT NEW.privada AND NEW.whatsapp_contact_id IS NOT NULL)
  EXECUTE FUNCTION private.mkt_resposta();

-- Resposta de campanha: a Alice atende mesmo cliente antigo (a regra "cliente antigo vai para a
-- equipe" não vale para quem está respondendo um disparo).
CREATE OR REPLACE FUNCTION private.mkt_resposta_de_campanha(_emp uuid, _contato uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (private.mkt_envio_recente(_emp,
           (SELECT normalized_phone FROM public.whatsapp_contacts WHERE id = _contato), 7)).id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION private.mkt_resposta_de_campanha(uuid, uuid) FROM PUBLIC, anon, authenticated;

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
       AND private.ia_cliente_antigo(NEW.whatsapp_contact_id)
       AND NOT private.mkt_resposta_de_campanha(NEW.empresa_id, NEW.whatsapp_contact_id) THEN
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

-- ---------------------------------------------------------------- gatilhos diários
CREATE OR REPLACE FUNCTION private.mkt_campanha_gatilho(_emp uuid, _gatilho text, _mes date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  id_campanha uuid;
  meses text[] := ARRAY['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  rotulo text := CASE _gatilho WHEN 'C1' THEN 'Pós-venda (C1)' WHEN 'C2' THEN 'Higienização 6 meses (C2)'
                               WHEN 'C3' THEN 'Impermeabilização 13º mês (C3)' ELSE 'Lembrete 13º mês (C3)' END;
BEGIN
  SELECT id INTO id_campanha FROM public.mkt_campanhas
   WHERE empresa_id = _emp AND tipo = 'gatilho' AND gatilho = _gatilho AND mes_ref = _mes;
  IF id_campanha IS NULL THEN
    INSERT INTO public.mkt_campanhas (empresa_id, nome, tipo, mes_ref, tema, gatilho, template_nome, status,
      custo_msg_estimado, grupos)
    VALUES (_emp, rotulo || ' — ' || meses[extract(month FROM _mes)::int] || '/' || to_char(_mes, 'YY'),
      'gatilho', _mes, rotulo, _gatilho,
      CASE _gatilho WHEN 'C1' THEN 'tc_posvenda_resultado' WHEN 'C2' THEN 'tc_higienizacao_6meses'
                    WHEN 'C3' THEN 'tc_imper_13meses' ELSE 'tc_imper_13meses_lembrete' END,
      'enviando', (private.mkt_config(_emp)).custo_msg_estimado,
      ARRAY[CASE _gatilho WHEN 'C3L' THEN 'C3' ELSE _gatilho END])
    ON CONFLICT (empresa_id, gatilho, mes_ref) WHERE tipo = 'gatilho' DO NOTHING
    RETURNING id INTO id_campanha;
    IF id_campanha IS NULL THEN
      SELECT id INTO id_campanha FROM public.mkt_campanhas
       WHERE empresa_id = _emp AND tipo = 'gatilho' AND gatilho = _gatilho AND mes_ref = _mes;
    END IF;
  END IF;
  RETURN id_campanha;
END $$;
REVOKE ALL ON FUNCTION private.mkt_campanha_gatilho(uuid, text, date) FROM PUBLIC, anon, authenticated;

-- Gera os toques do dia. Flag ligada: entram na fila (9h–hora_limite); desligada: ficam "manual"
-- para a tela "Gatilhos de hoje". Cada toque só uma vez (gatilho_ref).
CREATE OR REPLACE FUNCTION public.mkt_gerar_gatilhos(_emp uuid, _hoje date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hoje date := coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  mes date := date_trunc('month', coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date))::date;
  cfg public.mkt_configuracoes := private.mkt_config(_emp);
  g text;
  campanha uuid;
  lote uuid;
  ligado boolean;
  inicio timestamptz;
  n int;
  resultado jsonb := '{}';
BEGIN
  inicio := greatest(now(), (hoje + time '09:00')::timestamp AT TIME ZONE 'America/Sao_Paulo');
  FOREACH g IN ARRAY ARRAY['C1', 'C2', 'C3', 'C3L'] LOOP
    ligado := CASE g WHEN 'C1' THEN cfg.gatilho_c1_ligado WHEN 'C2' THEN cfg.gatilho_c2_ligado
                     ELSE cfg.gatilho_c3_ligado END;
    CREATE TEMP TABLE IF NOT EXISTS mkt_gat (contato_id uuid, fone text, ref text, sn boolean) ON COMMIT DROP;
    DELETE FROM mkt_gat;
    IF g = 'C1' THEN
      INSERT INTO mkt_gat
      SELECT c.id, c.normalized_phone, 'C1:' || c.ultima_work_order_id, c.primeiro_nome IS NULL
        FROM public.mkt_contatos c
       WHERE c.empresa_id = _emp AND c.optout_em IS NULL AND NOT c.sem_pos_venda
         AND c.ultima_work_order_id IS NOT NULL
         AND (c.pos_venda_em AT TIME ZONE 'America/Sao_Paulo')::date = hoje - 1;
    ELSIF g IN ('C2', 'C3') THEN
      INSERT INTO mkt_gat
      SELECT c.id, c.normalized_phone,
             g || ':' || c.id || ':' || (c.ultimo_servico_em AT TIME ZONE 'America/Sao_Paulo')::date,
             c.primeiro_nome IS NULL
        FROM public.mkt_contatos c
       WHERE c.empresa_id = _emp AND c.tipo = 'comprador' AND c.optout_em IS NULL AND NOT c.sem_pos_venda
         AND c.ultimo_servico_em IS NOT NULL
         AND ((g = 'C2' AND c.ultimo_servico_tipo = 'higienizacao'
               AND (c.ultimo_servico_em AT TIME ZONE 'America/Sao_Paulo')::date + interval '6 months'
                   BETWEEN hoje - 6 AND hoje)
           OR (g = 'C3' AND c.ultimo_servico_tipo = 'impermeabilizacao'
               AND (c.ultimo_servico_em AT TIME ZONE 'America/Sao_Paulo')::date + interval '1 year 15 days' <= hoje
               AND (c.ultimo_servico_em AT TIME ZONE 'America/Sao_Paulo')::date + interval '1 year 1 month' >= hoje))
         AND NOT coalesce(c.recusou_grupo = g AND c.recusou_em > now() - interval '120 days', false)
         AND NOT EXISTS (SELECT 1 FROM public.mkt_envios e JOIN public.mkt_campanhas k ON k.id = e.campanha_id
                          WHERE e.contato_id = c.id AND e.status = 'enviado'
                            AND e.enviado_em > now() - interval '30 days' AND k.gatilho IS DISTINCT FROM 'C1')
         AND NOT EXISTS (SELECT 1 FROM public.crm_leads l JOIN public.config_options s ON s.id = l.status_id
                          WHERE l.empresa_id = c.empresa_id AND l.is_open
                            AND private.telefone_chave(l.normalized_phone) = private.telefone_chave(c.normalized_phone)
                            AND s.metadata->>'stage' IN ('negociacao', 'orcamento', 'aguardando'));
    ELSE
      INSERT INTO mkt_gat
      SELECT c.id, c.normalized_phone, 'C3L:' || e.id, c.primeiro_nome IS NULL
        FROM public.mkt_envios e
        JOIN public.mkt_campanhas k ON k.id = e.campanha_id AND k.gatilho = 'C3'
        JOIN public.mkt_contatos c ON c.id = e.contato_id
       WHERE e.empresa_id = _emp AND e.status = 'enviado' AND e.respondido_em IS NULL
         AND e.enviado_em <= now() - interval '24 hours' AND e.enviado_em > now() - interval '7 days'
         AND c.optout_em IS NULL;
    END IF;

    SELECT count(*) INTO n FROM mkt_gat
     WHERE NOT EXISTS (SELECT 1 FROM public.mkt_envios x WHERE x.empresa_id = _emp AND x.gatilho_ref = mkt_gat.ref);
    IF n > 0 THEN
      campanha := private.mkt_campanha_gatilho(_emp, g, mes);
      INSERT INTO public.mkt_lotes (empresa_id, campanha_id, numero, etiqueta_chatwoot, data_prevista, status)
      VALUES (_emp, campanha, extract(day FROM hoje)::int,
              'gat-' || lower(g) || '-' || to_char(hoje, 'YYYY-MM-DD'), hoje, 'aprovado')
      ON CONFLICT (campanha_id, numero) DO UPDATE SET status = CASE
        WHEN public.mkt_lotes.status IN ('concluido') THEN 'enviando' ELSE public.mkt_lotes.status END
      RETURNING id INTO lote;
      INSERT INTO public.mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo,
        template_nome, variante_sn, ordem, gatilho_ref, status, agendado_para)
      SELECT _emp, campanha, lote, t.contato_id, t.fone, CASE g WHEN 'C3L' THEN 'C3' ELSE g END,
             (SELECT template_nome FROM public.mkt_campanhas WHERE id = campanha) || CASE WHEN t.sn THEN '_sn' ELSE '' END,
             t.sn, row_number() OVER (ORDER BY t.contato_id) - 1, t.ref,
             CASE WHEN ligado THEN 'pendente' ELSE 'manual' END,
             CASE WHEN ligado THEN inicio + make_interval(secs => (row_number() OVER (ORDER BY t.contato_id) - 1)::int
                                                              * cfg.intervalo_segundos) END
        FROM mkt_gat t
      ON CONFLICT (empresa_id, gatilho_ref) WHERE gatilho_ref IS NOT NULL DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT;
      UPDATE public.mkt_lotes SET quantidade = (SELECT count(*) FROM public.mkt_envios WHERE lote_id = lote)
       WHERE id = lote;
    END IF;
    resultado := resultado || jsonb_build_object(g, jsonb_build_object('novos', n, 'automatico', ligado));
  END LOOP;
  PERFORM private.mkt_log(_emp, 'gatilhos', 'gerados', resultado);
  RETURN resultado;
END $$;
REVOKE ALL ON FUNCTION public.mkt_gerar_gatilhos(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_gerar_gatilhos(uuid, date) TO service_role;

-- Resumo dos gatilhos (últimos N dias) para o aviso semanal.
CREATE OR REPLACE FUNCTION public.mkt_resumo_gatilhos(_emp uuid, _dias int DEFAULT 7)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_object_agg(g, dados), '{}') FROM (
    SELECT k.gatilho AS g, jsonb_build_object(
      'enviados', count(*) FILTER (WHERE e.status = 'enviado'),
      'respostas', count(*) FILTER (WHERE e.respondido_em IS NOT NULL),
      'vendas', count(*) FILTER (WHERE e.work_order_id IS NOT NULL),
      'valor', coalesce(sum(e.valor_venda), 0),
      'optouts', count(*) FILTER (WHERE c.optout_em IS NOT NULL AND c.optout_em >= e.enviado_em),
      'manuais_pendentes', count(*) FILTER (WHERE e.status = 'manual')) AS dados
      FROM public.mkt_envios e
      JOIN public.mkt_campanhas k ON k.id = e.campanha_id AND k.tipo = 'gatilho'
      JOIN public.mkt_contatos c ON c.id = e.contato_id
     WHERE e.empresa_id = _emp AND e.created_at > now() - make_interval(days => _dias)
     GROUP BY k.gatilho) x;
$$;
REVOKE ALL ON FUNCTION public.mkt_resumo_gatilhos(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_resumo_gatilhos(uuid, int) TO service_role;

-- ---------------------------------------------------------------- relatórios
CREATE VIEW public.vw_mkt_lotes_relatorio WITH (security_invoker = true) AS
SELECT l.id AS lote_id, l.empresa_id, l.campanha_id, l.numero, l.data_prevista, l.status, l.motivo_pausa,
       l.quantidade,
       count(e.id) FILTER (WHERE e.status IN ('enviado', 'erro')) AS tentativas,
       count(e.id) FILTER (WHERE e.status = 'enviado') AS enviados,
       count(e.id) FILTER (WHERE e.status = 'erro') AS erros,
       count(e.id) FILTER (WHERE e.bloqueio) AS bloqueios,
       count(e.id) FILTER (WHERE c.optout_em IS NOT NULL AND e.enviado_em IS NOT NULL AND c.optout_em >= e.enviado_em) AS optouts,
       round(100.0 * (count(e.id) FILTER (WHERE e.bloqueio)
             + count(e.id) FILTER (WHERE c.optout_em IS NOT NULL AND e.enviado_em IS NOT NULL AND c.optout_em >= e.enviado_em))
             / nullif(count(e.id) FILTER (WHERE e.status IN ('enviado', 'erro')), 0), 1) AS optout_bloqueio_pct,
       round(100.0 * count(e.id) FILTER (WHERE e.status = 'erro')
             / nullif(count(e.id) FILTER (WHERE e.status IN ('enviado', 'erro')), 0), 1) AS erro_pct
  FROM public.mkt_lotes l
  LEFT JOIN public.mkt_envios e ON e.lote_id = l.id
  LEFT JOIN public.mkt_contatos c ON c.id = e.contato_id
 GROUP BY l.id;

CREATE VIEW public.vw_mkt_campanhas_relatorio WITH (security_invoker = true) AS
SELECT k.id AS campanha_id, k.empresa_id, k.nome, k.tipo, k.gatilho, k.mes_ref, k.status,
       count(e.id) FILTER (WHERE e.status NOT IN ('cancelado')) AS contatos,
       count(e.id) FILTER (WHERE e.status = 'enviado') AS enviados,
       count(e.id) FILTER (WHERE e.status = 'erro') AS erros,
       count(e.id) FILTER (WHERE e.respondido_em IS NOT NULL) AS respostas,
       count(e.id) FILTER (WHERE e.quote_id IS NOT NULL) AS orcamentos,
       count(e.id) FILTER (WHERE e.work_order_id IS NOT NULL) AS vendas,
       coalesce(sum(e.valor_venda), 0) AS valor_vendido,
       count(e.id) FILTER (WHERE c.optout_em IS NOT NULL AND e.enviado_em IS NOT NULL AND c.optout_em >= e.enviado_em) AS optouts,
       count(e.id) FILTER (WHERE e.bloqueio) AS bloqueios,
       round(count(e.id) FILTER (WHERE e.status = 'enviado') * k.custo_msg_estimado, 2) AS custo_estimado,
       round(coalesce(sum(e.valor_venda), 0)
             / nullif(count(e.id) FILTER (WHERE e.status = 'enviado') * k.custo_msg_estimado, 0), 1) AS retorno
  FROM public.mkt_campanhas k
  LEFT JOIN public.mkt_envios e ON e.campanha_id = k.id
  LEFT JOIN public.mkt_contatos c ON c.id = e.contato_id
 GROUP BY k.id;

REVOKE ALL ON public.vw_mkt_lotes_relatorio, public.vw_mkt_campanhas_relatorio FROM anon, authenticated;
GRANT SELECT ON public.vw_mkt_lotes_relatorio, public.vw_mkt_campanhas_relatorio TO authenticated, service_role;
