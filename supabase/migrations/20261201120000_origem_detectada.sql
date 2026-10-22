-- Origem automática no orçamento e na OS (aprovada em 22/10/2026).
-- 1. work_orders e quotes: origem detectada (e como), quem indicou, e quem trocou a origem detectada
--    por outra e quando. quotes ganha a origem da venda (antes só o lead tinha).
-- 2. private.origem_detectada_venda: a origem que o app sabe pelo lead/conversa ou pelo telefone,
--    na ordem: clique da landing → origem automática do lead (primeira mensagem, botão do anúncio,
--    site/blog, canal) → primeira mensagem lida de novo → resposta a campanha → indicação
--    registrada → cliente com OS anterior. public.origem_detectada_venda é a leitura pela tela.
-- 3. Gatilho: quando a origem salva é diferente da detectada, grava quem trocou e quando.
-- Nada é apagado e nenhuma OS antiga muda.

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS origem_detectada_id uuid REFERENCES public.config_options(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origem_detectada_como text,
  ADD COLUMN IF NOT EXISTS origem_trocada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origem_trocada_em timestamptz,
  ADD COLUMN IF NOT EXISTS indicacao_nome text;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS sales_origin_id uuid REFERENCES public.config_options(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origem_detectada_id uuid REFERENCES public.config_options(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origem_detectada_como text,
  ADD COLUMN IF NOT EXISTS origem_trocada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origem_trocada_em timestamptz,
  ADD COLUMN IF NOT EXISTS indicacao_nome text;

DO $$
BEGIN
  ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_origem_detectada_como_check
    CHECK (origem_detectada_como IN ('landing', 'botao_anuncio', 'site_blog', 'canal', 'primeira_mensagem',
                                     'campanha', 'indicacao', 'cliente_antigo', 'alice'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE public.quotes ADD CONSTRAINT quotes_origem_detectada_como_check
    CHECK (origem_detectada_como IN ('landing', 'botao_anuncio', 'site_blog', 'canal', 'primeira_mensagem',
                                     'campanha', 'indicacao', 'cliente_antigo', 'alice'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_work_orders_origem_detectada
  ON public.work_orders (empresa_id, created_at) WHERE origem_detectada_id IS NOT NULL;

-- ================================================================ detecção
CREATE OR REPLACE FUNCTION private.origem_detectada_venda(_emp uuid, _lead uuid, _telefone text)
RETURNS TABLE (origem_id uuid, como text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.crm_leads;
  chave text := nullif(private.telefone_chave(private.normalizar_telefone(coalesce(_telefone, ''))), '');
  o uuid;
  cod text;
  txt text;
BEGIN
  IF _emp IS NULL THEN RETURN; END IF;
  IF _lead IS NOT NULL THEN
    SELECT * INTO l FROM public.crm_leads WHERE id = _lead AND empresa_id = _emp;
  END IF;
  -- Sem lead: o lead mais recente do mesmo telefone (conversa dos últimos 120 dias).
  IF l.id IS NULL AND length(coalesce(chave, '')) >= 10 THEN
    SELECT * INTO l FROM public.crm_leads x
     WHERE x.empresa_id = _emp AND private.telefone_chave(x.normalized_phone) = chave
       AND coalesce(x.last_interaction_at, x.updated_at) > now() - interval '120 days'
     ORDER BY coalesce(x.last_interaction_at, x.updated_at) DESC NULLS LAST LIMIT 1;
  END IF;

  IF l.id IS NOT NULL THEN
    chave := coalesce(chave, nullif(private.telefone_chave(l.normalized_phone), ''));
    -- 1. Clique do anúncio (pop-up da landing).
    IF EXISTS (SELECT 1 FROM public.ads_clicks a
                WHERE a.crm_lead_id = l.id AND a.empresa_id = _emp
                  AND (a.gclid IS NOT NULL OR a.gbraid IS NOT NULL)) THEN
      o := coalesce(CASE WHEN l.origem_automatica THEN l.sales_origin_id END,
                    private.origem_por_codigo(_emp, 'google_ads_landing'),
                    private.origem_por_codigo(_emp, 'google'));
      IF o IS NOT NULL THEN
        origem_id := o; como := 'landing'; RETURN NEXT; RETURN;
      END IF;
    END IF;
    -- 2. Origem automática do lead.
    o := CASE WHEN l.origem_automatica THEN l.sales_origin_id END;
    -- 3. Sem automática: a primeira mensagem do cliente, lida de novo.
    IF o IS NULL THEN
      SELECT m.text_content INTO txt FROM public.whatsapp_messages m
       WHERE m.crm_lead_id = l.id AND m.empresa_id = _emp AND m.direction = 'Recebida'
         AND NOT m.privada AND m.text_content IS NOT NULL
       ORDER BY m.created_at LIMIT 1;
      IF txt IS NOT NULL THEN
        o := (SELECT i.origem FROM private.identificar_origem_lead(_emp, txt, NULL, false, NULL) i);
      END IF;
    END IF;
    -- 4. Respondeu a uma campanha.
    IF o IS NULL AND (l.campaign_id IS NOT NULL OR EXISTS (
         SELECT 1 FROM public.mkt_envios e WHERE e.crm_lead_id = l.id AND e.respondido_em IS NOT NULL)) THEN
      o := private.origem_por_codigo(_emp, 'whatsapp_campanha');
    END IF;
    IF o IS NOT NULL THEN
      cod := (SELECT c.metadata->>'codigo' FROM public.config_options c WHERE c.id = o);
      origem_id := o;
      como := CASE cod
        WHEN 'google_ads_landing' THEN 'landing'
        WHEN 'google_ads_whatsapp' THEN 'botao_anuncio'
        WHEN 'site' THEN 'site_blog'
        WHEN 'blog' THEN 'site_blog'
        WHEN 'instagram' THEN 'canal'
        WHEN 'facebook' THEN 'canal'
        WHEN 'whatsapp_campanha' THEN 'campanha'
        WHEN 'indicacao' THEN 'indicacao'
        WHEN 'cliente_existente' THEN 'cliente_antigo'
        ELSE 'primeira_mensagem' END;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF chave IS NULL THEN RETURN; END IF;
  -- 5. Indicação registrada (marketing / Alice).
  IF EXISTS (SELECT 1 FROM public.indicacoes i
              WHERE i.empresa_id = _emp
                AND private.telefone_chave(private.normalizar_telefone(i.indicado_phone)) = chave) THEN
    o := private.origem_por_codigo(_emp, 'indicacao');
    IF o IS NOT NULL THEN
      origem_id := o; como := 'indicacao'; RETURN NEXT; RETURN;
    END IF;
  END IF;
  -- 6. Cliente com OS anterior.
  IF EXISTS (SELECT 1 FROM public.work_orders w JOIN public.customers c ON c.id = w.customer_id
              WHERE w.empresa_id = _emp AND w.deleted_at IS NULL AND NOT w.eh_teste
                AND private.telefone_chave(private.normalizar_telefone(c.phone)) = chave) THEN
    o := private.origem_por_codigo(_emp, 'cliente_existente');
    IF o IS NOT NULL THEN
      origem_id := o; como := 'cliente_antigo'; RETURN NEXT; RETURN;
    END IF;
  END IF;
  RETURN;
END $$;
REVOKE ALL ON FUNCTION private.origem_detectada_venda(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.origem_detectada_venda(uuid, uuid, text) TO service_role;

-- Leitura pela tela (empresa ativa; administrador e atendente).
CREATE OR REPLACE FUNCTION public.origem_detectada_venda(_lead uuid DEFAULT NULL, _telefone text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp uuid := private.empresa_ativa();
  r record;
BEGIN
  IF emp IS NULL OR NOT (private.tem_papel('admin') OR private.tem_papel('atendente')) THEN
    RETURN '{}'::jsonb;
  END IF;
  SELECT * INTO r FROM private.origem_detectada_venda(emp, _lead, _telefone) LIMIT 1;
  IF r.origem_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  RETURN jsonb_build_object('origem_id', r.origem_id, 'como', r.como);
END $$;
REVOKE ALL ON FUNCTION public.origem_detectada_venda(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.origem_detectada_venda(uuid, text) TO authenticated, service_role;

-- ================================================================ troca
CREATE OR REPLACE FUNCTION private.origem_registrar_troca()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Origem detectada de outra empresa não vale.
  IF NEW.origem_detectada_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.config_options c
        WHERE c.id = NEW.origem_detectada_id AND c.empresa_id = NEW.empresa_id) THEN
    NEW.origem_detectada_id := NULL;
    NEW.origem_detectada_como := NULL;
  END IF;
  IF NEW.origem_detectada_id IS NULL OR NEW.sales_origin_id IS NULL
     OR NEW.sales_origin_id = NEW.origem_detectada_id THEN
    NEW.origem_trocada_por := NULL;
    NEW.origem_trocada_em := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.sales_origin_id IS DISTINCT FROM NEW.sales_origin_id
        OR OLD.origem_detectada_id IS DISTINCT FROM NEW.origem_detectada_id THEN
    NEW.origem_trocada_por := auth.uid();
    NEW.origem_trocada_em := now();
  ELSE
    NEW.origem_trocada_por := OLD.origem_trocada_por;
    NEW.origem_trocada_em := OLD.origem_trocada_em;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.origem_registrar_troca() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_work_orders_origem_troca ON public.work_orders;
CREATE TRIGGER trg_work_orders_origem_troca
  BEFORE INSERT OR UPDATE OF sales_origin_id, origem_detectada_id, origem_trocada_por, origem_trocada_em
  ON public.work_orders FOR EACH ROW EXECUTE FUNCTION private.origem_registrar_troca();

DROP TRIGGER IF EXISTS trg_quotes_origem_troca ON public.quotes;
CREATE TRIGGER trg_quotes_origem_troca
  BEFORE INSERT OR UPDATE OF sales_origin_id, origem_detectada_id, origem_trocada_por, origem_trocada_em
  ON public.quotes FOR EACH ROW EXECUTE FUNCTION private.origem_registrar_troca();
