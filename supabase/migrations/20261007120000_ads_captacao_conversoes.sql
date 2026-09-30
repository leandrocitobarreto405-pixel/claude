-- Google Ads: captação dos leads das landing pages, vínculo com o CRM e exportação das vendas
-- como conversão offline.
--
--  * ads_clicks: um registro por envio do pop-up das landings (clique no anúncio + telefone).
--    Nada de anúncio vai para crm_leads: a ligação é ads_clicks.crm_lead_id.
--  * ads_dominios: domínios das landings que podem enviar (CORS) e a empresa de cada um.
--  * ads_configuracoes: planilha da exportação e a fase 2 (Alice inicia a conversa; desligada).
--  * ads_eventos: log de cada etapa (captação, vínculo, WhatsApp, exportação, Alice).
--  * Vínculo pelo telefone com tolerância ao 9º dígito: o WhatsApp manda alguns celulares sem o 9
--    (5511 9693-5920 em vez de 5511 96935-9207). private.telefone_chave = DDD + últimos 8 dígitos.
--  * vw_conversoes_google: vendas (crm_leads.faturado_em) com gclid ainda não enviadas, no formato
--    da importação offline do Google Ads. Valor = work_orders.total_gross_value (total da OS).

-- ---------------------------------------------------------------- telefone
CREATE OR REPLACE FUNCTION private.telefone_chave(_normalizado text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN _normalizado ~ '^55[0-9]{10,11}$' THEN substr(_normalizado, 3, 2) || right(_normalizado, 8)
    ELSE _normalizado
  END;
$$;
REVOKE ALL ON FUNCTION private.telefone_chave(text) FROM PUBLIC, anon, authenticated;

CREATE INDEX idx_crm_leads_telefone_chave
  ON public.crm_leads (empresa_id, private.telefone_chave(normalized_phone));

-- ---------------------------------------------------------------- configuração
CREATE TABLE public.ads_configuracoes (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  -- ID da planilha do Google Sheets da importação offline (no Drive da conta Google conectada).
  google_planilha_id text CHECK (google_planilha_id ~ '^[A-Za-z0-9_-]{20,100}$'),
  -- Fase 2: a Alice inicia a conversa com quem preencheu o pop-up e não chamou no WhatsApp.
  -- Exige modelo de mensagem aprovado pela Meta; não liga sem o nome do modelo.
  alice_iniciar_conversa boolean NOT NULL DEFAULT false,
  alice_iniciar_apos_minutos int NOT NULL DEFAULT 3 CHECK (alice_iniciar_apos_minutos BETWEEN 1 AND 60),
  alice_template_nome text,
  alice_template_idioma text NOT NULL DEFAULT 'pt_BR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ads_configuracoes_alice_template
    CHECK (NOT alice_iniciar_conversa OR nullif(btrim(alice_template_nome), '') IS NOT NULL)
);
ALTER TABLE public.ads_configuracoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ads_configuracoes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ads_configuracoes TO authenticated;
GRANT ALL ON public.ads_configuracoes TO service_role;
CREATE POLICY ads_configuracoes_select ON public.ads_configuracoes FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));
CREATE POLICY ads_configuracoes_insert ON public.ads_configuracoes FOR INSERT TO authenticated
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
CREATE POLICY ads_configuracoes_update ON public.ads_configuracoes FOR UPDATE TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')))
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
CREATE TRIGGER trg_ads_configuracoes_upd BEFORE UPDATE ON public.ads_configuracoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Domínio (host, sem https://) → empresa. Um domínio pertence a uma empresa só.
CREATE TABLE public.ads_dominios (
  dominio text PRIMARY KEY CHECK (dominio ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ads_dominios_empresa ON public.ads_dominios (empresa_id);
ALTER TABLE public.ads_dominios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ads_dominios FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.ads_dominios TO authenticated;
GRANT ALL ON public.ads_dominios TO service_role;
CREATE POLICY ads_dominios_select ON public.ads_dominios FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));
CREATE POLICY ads_dominios_insert ON public.ads_dominios FOR INSERT TO authenticated
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
CREATE POLICY ads_dominios_delete ON public.ads_dominios FOR DELETE TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));

-- ---------------------------------------------------------------- cliques
CREATE TABLE public.ads_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  nome text,
  telefone_raw text NOT NULL,
  normalized_phone text NOT NULL,
  gclid text,
  gbraid text,
  wbraid text,
  fbclid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  page_url text,
  servico text CHECK (servico IN ('higienizacao', 'impermeabilizacao')),
  crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  vinculado_em timestamptz,
  whatsapp_iniciado_em timestamptz,
  alice_contato_em timestamptz,
  enviado_google_em timestamptz,
  enviado_meta_em timestamptz
);
CREATE INDEX idx_ads_clicks_normalized_phone ON public.ads_clicks (normalized_phone);
CREATE INDEX idx_ads_clicks_gclid ON public.ads_clicks (gclid) WHERE gclid IS NOT NULL;
CREATE INDEX idx_ads_clicks_crm_lead ON public.ads_clicks (crm_lead_id);
CREATE INDEX idx_ads_clicks_empresa ON public.ads_clicks (empresa_id, created_at DESC);
CREATE INDEX idx_ads_clicks_telefone_chave
  ON public.ads_clicks (empresa_id, private.telefone_chave(normalized_phone), created_at DESC);
-- Fase 2: quem preencheu o pop-up e ainda não chamou no WhatsApp.
CREATE INDEX idx_ads_clicks_sem_whatsapp ON public.ads_clicks (created_at)
  WHERE whatsapp_iniciado_em IS NULL AND alice_contato_em IS NULL;
ALTER TABLE public.ads_clicks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ads_clicks FROM anon, authenticated;
GRANT SELECT ON public.ads_clicks TO authenticated;
GRANT ALL ON public.ads_clicks TO service_role;
CREATE POLICY ads_clicks_select ON public.ads_clicks FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));
CREATE TRIGGER trg_ads_clicks_valida_empresa BEFORE INSERT OR UPDATE ON public.ads_clicks
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias('crm_lead_id', 'crm_leads');

-- Telefone sempre normalizado pela mesma regra do CRM.
CREATE OR REPLACE FUNCTION private.ads_clicks_normalizar()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.normalized_phone := private.normalizar_telefone(NEW.telefone_raw);
  IF NEW.normalized_phone IS NULL THEN
    RAISE EXCEPTION 'ads_clicks: telefone vazio' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.ads_clicks_normalizar() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_ads_clicks_normalizar BEFORE INSERT OR UPDATE OF telefone_raw, normalized_phone
  ON public.ads_clicks FOR EACH ROW EXECUTE FUNCTION private.ads_clicks_normalizar();

-- ---------------------------------------------------------------- log
CREATE TABLE public.ads_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  tipo text NOT NULL CHECK (tipo IN ('captacao', 'vinculo', 'whatsapp', 'exportacao_google', 'alice')),
  resultado text NOT NULL,
  ads_click_id uuid REFERENCES public.ads_clicks(id) ON DELETE SET NULL,
  -- sha256 do IP (nunca o IP puro), para o limite por IP.
  ip_hash text,
  detalhe jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_ads_eventos_empresa ON public.ads_eventos (empresa_id, created_at DESC);
CREATE INDEX idx_ads_eventos_ip ON public.ads_eventos (ip_hash, created_at DESC) WHERE tipo = 'captacao';
CREATE INDEX idx_ads_eventos_click ON public.ads_eventos (ads_click_id);
ALTER TABLE public.ads_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ads_eventos FROM anon, authenticated;
GRANT SELECT ON public.ads_eventos TO authenticated;
GRANT ALL ON public.ads_eventos TO service_role;
CREATE POLICY ads_eventos_select ON public.ads_eventos FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));

-- ---------------------------------------------------------------- vínculo com o lead
-- Liga ao lead o clique mais recente do mesmo telefone (últimos 90 dias) ainda sem lead.
CREATE OR REPLACE FUNCTION private.ads_vincular_lead(_lead_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.crm_leads;
  clique uuid;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = _lead_id;
  IF l.id IS NULL OR l.normalized_phone IS NULL OR l.normalized_phone = '' THEN
    RETURN NULL;
  END IF;
  SELECT a.id INTO clique FROM public.ads_clicks a
   WHERE a.empresa_id = l.empresa_id
     AND private.telefone_chave(a.normalized_phone) = private.telefone_chave(l.normalized_phone)
     AND a.created_at >= now() - interval '90 days'
     AND a.crm_lead_id IS NULL
   ORDER BY a.created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF clique IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public.ads_clicks SET crm_lead_id = l.id, vinculado_em = now() WHERE id = clique;
  INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, ads_click_id, detalhe)
  VALUES (l.empresa_id, 'vinculo', 'vinculado', clique,
          jsonb_build_object('crm_lead_id', l.id, 'origem', 'lead'));
  RETURN clique;
END $$;
REVOKE ALL ON FUNCTION private.ads_vincular_lead(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.ads_lead_telefone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM private.ads_vincular_lead(NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.ads_lead_telefone() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_crm_leads_ads_insert AFTER INSERT ON public.crm_leads
  FOR EACH ROW WHEN (NEW.normalized_phone IS NOT NULL)
  EXECUTE FUNCTION private.ads_lead_telefone();
CREATE TRIGGER trg_crm_leads_ads_telefone AFTER UPDATE OF normalized_phone ON public.crm_leads
  FOR EACH ROW WHEN (NEW.normalized_phone IS DISTINCT FROM OLD.normalized_phone AND NEW.normalized_phone IS NOT NULL)
  EXECUTE FUNCTION private.ads_lead_telefone();

-- Primeira mensagem do cliente no WhatsApp depois do pop-up.
CREATE OR REPLACE FUNCTION private.ads_whatsapp_iniciado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  quando timestamptz := coalesce(NEW.message_timestamp, now());
  fone text;
  r record;
BEGIN
  SELECT normalized_phone INTO fone FROM public.whatsapp_contacts WHERE id = NEW.whatsapp_contact_id;
  IF fone IS NULL THEN
    RETURN NEW;
  END IF;
  FOR r IN
    UPDATE public.ads_clicks a SET whatsapp_iniciado_em = quando
     WHERE a.empresa_id = NEW.empresa_id
       AND private.telefone_chave(a.normalized_phone) = private.telefone_chave(fone)
       AND a.whatsapp_iniciado_em IS NULL
       AND a.created_at BETWEEN quando - interval '90 days' AND quando + interval '10 minutes'
    RETURNING a.id
  LOOP
    INSERT INTO public.ads_eventos (empresa_id, tipo, resultado, ads_click_id, detalhe)
    VALUES (NEW.empresa_id, 'whatsapp', 'iniciado', r.id, jsonb_build_object('mensagem_id', NEW.id));
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.ads_whatsapp_iniciado() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_whatsapp_messages_ads AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW WHEN (NEW.direction = 'Recebida' AND NEW.whatsapp_contact_id IS NOT NULL)
  EXECUTE FUNCTION private.ads_whatsapp_iniciado();

-- ---------------------------------------------------------------- captação (chamada pelo servidor)
-- Texto limpo: sem espaços nas pontas, vazio vira NULL, cortado no tamanho máximo.
CREATE OR REPLACE FUNCTION private.ads_texto(_valor text, _max int)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT left(nullif(btrim(regexp_replace(coalesce(_valor, ''), '[[:cntrl:]]', ' ', 'g')), ''), _max);
$$;
REVOKE ALL ON FUNCTION private.ads_texto(text, int) FROM PUBLIC, anon, authenticated;

-- Grava o envio do pop-up. Nunca levanta erro para o chamador: devolve o resultado e registra o
-- motivo em ads_eventos. Resultados: gravado, duplicado, invalido, dominio_desconhecido, limite.
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
    WHEN servico_txt ~ 'hig[ie]n' THEN 'higienizacao'
    WHEN lower(coalesce(pagina, '') || ' ' || host) LIKE '%imper%' THEN 'impermeabilizacao'
    WHEN lower(coalesce(pagina, '') || ' ' || host) ~ 'hig[ie]n' THEN 'higienizacao'
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
REVOKE ALL ON FUNCTION public.ads_registrar_clique(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ads_registrar_clique(text, text, jsonb) TO service_role;

-- ---------------------------------------------------------------- conversões para o Google Ads
-- Uma linha por venda: o clique com gclid mais recente do lead, antes da venda e até 90 dias antes
-- dela (janela da importação). Lead que já teve conversão enviada não volta.
-- Horário da conversão: crm_leads.faturado_em (data do pagamento, 12h de São Paulo); se cair
-- antes do clique (pagamento no mesmo dia), usa 1 minuto depois do clique (o Google recusa
-- conversão anterior ao clique).
CREATE VIEW public.vw_conversoes_google_pendentes WITH (security_invoker = true) AS
SELECT DISTINCT ON (a.crm_lead_id)
       a.id AS ads_click_id,
       a.empresa_id,
       a.crm_lead_id,
       a.gclid,
       CASE coalesce(a.servico,
                     CASE WHEN l.service_interest ILIKE '%imper%' THEN 'impermeabilizacao' END,
                     'higienizacao')
         WHEN 'impermeabilizacao' THEN 'Venda Impermeabilização'
         ELSE 'Venda Higienização'
       END AS conversao_nome,
       greatest(l.faturado_em, a.created_at + interval '1 minute') AS conversao_em,
       to_char(greatest(l.faturado_em, a.created_at + interval '1 minute') AT TIME ZONE 'America/Sao_Paulo',
               'YYYY-MM-DD HH24:MI:SS') || '-03:00' AS conversao_horario,
       w.total_gross_value AS valor
  FROM public.ads_clicks a
  JOIN public.crm_leads l ON l.id = a.crm_lead_id AND l.empresa_id = a.empresa_id
  JOIN public.work_orders w ON w.id = l.linked_work_order_id AND w.empresa_id = l.empresa_id
                            AND w.deleted_at IS NULL
 WHERE a.gclid IS NOT NULL
   AND a.enviado_google_em IS NULL
   AND l.faturado_em IS NOT NULL
   AND a.created_at <= l.faturado_em + interval '1 day'
   AND l.faturado_em < a.created_at + interval '90 days'
   AND NOT EXISTS (SELECT 1 FROM public.ads_clicks x
                    WHERE x.crm_lead_id = a.crm_lead_id AND x.enviado_google_em IS NOT NULL)
 ORDER BY a.crm_lead_id, a.created_at DESC;

-- Formato exato da importação offline do Google Ads (planilha com
-- "Parameters:TimeZone=America/Sao_Paulo" na primeira linha).
CREATE VIEW public.vw_conversoes_google WITH (security_invoker = true) AS
SELECT gclid AS "Google Click ID",
       conversao_nome AS "Conversion Name",
       conversao_horario AS "Conversion Time",
       valor AS "Conversion Value",
       'BRL'::text AS "Conversion Currency"
  FROM public.vw_conversoes_google_pendentes
 ORDER BY conversao_em;

REVOKE ALL ON public.vw_conversoes_google_pendentes, public.vw_conversoes_google FROM anon, authenticated;
GRANT SELECT ON public.vw_conversoes_google_pendentes, public.vw_conversoes_google TO authenticated;
GRANT SELECT ON public.vw_conversoes_google_pendentes, public.vw_conversoes_google TO service_role;
