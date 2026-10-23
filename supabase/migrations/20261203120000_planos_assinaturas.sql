-- Fase B, item 1: planos, assinaturas e "vendido por" (decisões A, B, C e D de 23/10/2026).
-- 1. public.planos: catálogo global da Nexa, SEM empresa_id (decisão A): as empresas só leem, só o
--    admin da Nexa altera. Básico R$ 50, Completo R$ 297, Nexa Gestão (mensalidade a definir, 5%)
--    e Interna R$ 0.
-- 2. public.assinaturas: plano de cada empresa com vigência (como contratos_comissao): valor
--    (vazio = o do plano), status trial/ativa/inadimplente/cancelada, grátis até, vencimento, ids no
--    gateway e o PDF do contrato assinado (só Nexa Gestão; bucket privado "contratos").
--    Turbine: Interna, ativa. Ecoprime: Nexa Gestão, 3 meses grátis desde 03/10/2026.
-- 3. work_orders.vendido_por: "nexa" (atendente da Nexa ou Alice) ou "empresa", gravado pela
--    vendedora da OS. As OS existentes recebem o valor pela vendedora atual.
-- 4. private.comissao_nexa_pct(empresa, data): % do contrato vigente na data da venda.
-- O percentual da comissão continua em contratos_comissao (configurável por empresa; 0% = só
-- plataforma). Nada é apagado; empresas.plano fica como está (o app não usa).

-- ================================================================ planos
CREATE TABLE IF NOT EXISTS public.planos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE CHECK (codigo ~ '^[a-z][a-z_]*$'),
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 2 AND 60),
  descricao text,
  -- NULL = mensalidade ainda não definida (Nexa Gestão).
  preco_mensal numeric(10,2) CHECK (preco_mensal IS NULL OR preco_mensal >= 0),
  -- Comissão padrão da Nexa sobre as vendas da equipe Nexa (o contrato da empresa pode mudar).
  comissao_pct numeric(6,3) NOT NULL DEFAULT 0 CHECK (comissao_pct BETWEEN 0 AND 100),
  -- Recursos: caixa_entrada, alice, marketing (agenda, OS, orçamento e financeiro: todos).
  recursos jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(recursos) = 'object'),
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.planos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planos FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.planos TO authenticated;
GRANT ALL ON public.planos TO service_role;
DROP POLICY IF EXISTS planos_select ON public.planos;
CREATE POLICY planos_select ON public.planos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS planos_nexa_insert ON public.planos;
CREATE POLICY planos_nexa_insert ON public.planos FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_nexa_admin()));
DROP POLICY IF EXISTS planos_nexa_update ON public.planos;
CREATE POLICY planos_nexa_update ON public.planos FOR UPDATE TO authenticated
  USING ((SELECT private.is_nexa_admin())) WITH CHECK ((SELECT private.is_nexa_admin()));
DROP TRIGGER IF EXISTS trg_planos_upd ON public.planos;
CREATE TRIGGER trg_planos_upd BEFORE UPDATE ON public.planos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.planos (codigo, nome, descricao, preco_mensal, comissao_pct, recursos, ordem) VALUES
  ('basico', 'Básico', 'Agenda, OS, orçamento e financeiro. Sem WhatsApp nem Alice.', 50, 0,
   '{"caixa_entrada": false, "alice": false, "marketing": false}', 1),
  ('completo', 'Completo', 'Tudo, com caixa de entrada, Alice e marketing.', 297, 0,
   '{"caixa_entrada": true, "alice": true, "marketing": true}', 2),
  ('nexa_gestao', 'Nexa Gestão', 'Completo + equipe de vendas da Nexa; comissão sobre as vendas da Nexa e da Alice.',
   NULL, 5, '{"caixa_entrada": true, "alice": true, "marketing": true}', 3),
  ('interna', 'Interna', 'Uso da própria Nexa, sem mensalidade.', 0, 0,
   '{"caixa_entrada": true, "alice": true, "marketing": true}', 4)
ON CONFLICT (codigo) DO NOTHING;

-- ================================================================ assinaturas
CREATE TABLE IF NOT EXISTS public.assinaturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  plano_id uuid NOT NULL REFERENCES public.planos(id),
  -- NULL = a mensalidade do plano (inclusive quando ela ainda vai ser definida).
  valor_mensal numeric(10,2) CHECK (valor_mensal IS NULL OR valor_mensal >= 0),
  status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('trial', 'ativa', 'inadimplente', 'cancelada')),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  -- Último dia sem mensalidade (cliente da consultoria: 3 meses).
  gratis_ate date,
  proximo_vencimento date,
  inadimplente_desde date,
  gateway text CHECK (gateway IS NULL OR gateway IN ('asaas')),
  gateway_cliente_id text,
  gateway_assinatura_id text,
  -- Contrato assinado (PDF no bucket "contratos"; só Nexa Gestão).
  contrato_pdf_path text,
  contrato_pdf_em timestamptz,
  contrato_pdf_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  observacoes text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CHECK (gratis_ate IS NULL OR gratis_ate >= vigencia_inicio),
  UNIQUE (empresa_id, vigencia_inicio)
);
CREATE UNIQUE INDEX IF NOT EXISTS assinaturas_uma_vigente ON public.assinaturas (empresa_id)
  WHERE vigencia_fim IS NULL;
ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assinaturas FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.assinaturas TO authenticated;
GRANT ALL ON public.assinaturas TO service_role;
DROP POLICY IF EXISTS assinaturas_select ON public.assinaturas;
CREATE POLICY assinaturas_select ON public.assinaturas FOR SELECT TO authenticated
  USING ((SELECT private.is_nexa_admin()) OR private.tem_papel_na_empresa(empresa_id, 'admin'));
DROP POLICY IF EXISTS assinaturas_nexa_insert ON public.assinaturas;
CREATE POLICY assinaturas_nexa_insert ON public.assinaturas FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_nexa_admin()));
DROP POLICY IF EXISTS assinaturas_nexa_update ON public.assinaturas;
CREATE POLICY assinaturas_nexa_update ON public.assinaturas FOR UPDATE TO authenticated
  USING ((SELECT private.is_nexa_admin())) WITH CHECK ((SELECT private.is_nexa_admin()));
DROP TRIGGER IF EXISTS trg_assinaturas_upd ON public.assinaturas;
CREATE TRIGGER trg_assinaturas_upd BEFORE UPDATE ON public.assinaturas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Troca o plano (ou o valor/status) a partir de uma data: encerra a vigência atual e abre outra.
-- Mesma data de início: corrige a vigência atual. Só o admin da Nexa.
CREATE OR REPLACE FUNCTION private.definir_assinatura(
  _empresa_id uuid, _plano text, _inicio date, _valor numeric DEFAULT NULL,
  _status text DEFAULT 'ativa', _gratis_ate date DEFAULT NULL, _proximo_vencimento date DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  atual public.assinaturas;
  plano uuid;
  novo uuid;
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'apenas a Nexa altera a assinatura';
  END IF;
  SELECT id INTO plano FROM public.planos WHERE codigo = _plano;
  IF plano IS NULL THEN RAISE EXCEPTION 'plano % não existe', _plano; END IF;
  IF _inicio IS NULL THEN _inicio := private.hoje_sp(); END IF;

  SELECT * INTO atual FROM public.assinaturas
   WHERE empresa_id = _empresa_id AND vigencia_fim IS NULL FOR UPDATE;
  IF atual.id IS NOT NULL THEN
    IF _inicio = atual.vigencia_inicio THEN
      UPDATE public.assinaturas
         SET plano_id = plano, valor_mensal = _valor, status = _status, gratis_ate = _gratis_ate,
             proximo_vencimento = _proximo_vencimento
       WHERE id = atual.id;
      RETURN atual.id;
    END IF;
    IF _inicio < atual.vigencia_inicio THEN
      RAISE EXCEPTION 'a nova vigência precisa começar depois de %', atual.vigencia_inicio;
    END IF;
    UPDATE public.assinaturas SET vigencia_fim = _inicio - 1 WHERE id = atual.id;
  END IF;

  INSERT INTO public.assinaturas (empresa_id, plano_id, valor_mensal, status, vigencia_inicio,
    gratis_ate, proximo_vencimento, gateway, gateway_cliente_id, gateway_assinatura_id,
    contrato_pdf_path, contrato_pdf_em, contrato_pdf_por)
  VALUES (_empresa_id, plano, _valor, _status, _inicio, _gratis_ate, _proximo_vencimento,
    atual.gateway, atual.gateway_cliente_id, atual.gateway_assinatura_id,
    atual.contrato_pdf_path, atual.contrato_pdf_em, atual.contrato_pdf_por)
  RETURNING id INTO novo;
  RETURN novo;
END $$;
REVOKE ALL ON FUNCTION private.definir_assinatura(uuid, text, date, numeric, text, date, date)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.definir_assinatura(
  _empresa_id uuid, _plano text, _inicio date, _valor numeric DEFAULT NULL,
  _status text DEFAULT 'ativa', _gratis_ate date DEFAULT NULL, _proximo_vencimento date DEFAULT NULL
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT private.definir_assinatura(_empresa_id, _plano, _inicio, _valor, _status, _gratis_ate,
                                    _proximo_vencimento);
$$;
REVOKE ALL ON FUNCTION public.definir_assinatura(uuid, text, date, numeric, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_assinatura(uuid, text, date, numeric, text, date, date)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.definir_assinatura(uuid, text, date, numeric, text, date, date)
  TO authenticated;

-- Contrato assinado (PDF): bucket privado, uma pasta por empresa; só o admin da Nexa lê e envia.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('contratos', 'contratos', false, 10485760, ARRAY['application/pdf'])
    ON CONFLICT (id) DO NOTHING;
    EXECUTE 'DROP POLICY IF EXISTS contratos_nexa_select ON storage.objects';
    EXECUTE $p$CREATE POLICY contratos_nexa_select ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'contratos' AND (SELECT private.is_nexa_admin()))$p$;
    EXECUTE 'DROP POLICY IF EXISTS contratos_nexa_insert ON storage.objects';
    EXECUTE $p$CREATE POLICY contratos_nexa_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'contratos' AND (SELECT private.is_nexa_admin()))$p$;
    EXECUTE 'DROP POLICY IF EXISTS contratos_nexa_update ON storage.objects';
    EXECUTE $p$CREATE POLICY contratos_nexa_update ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'contratos' AND (SELECT private.is_nexa_admin()))$p$;
  END IF;
END $$;

-- Empresas atuais (decisão B). Só cria se ainda não houver assinatura.
INSERT INTO public.assinaturas (empresa_id, plano_id, valor_mensal, status, vigencia_inicio, observacoes, created_by)
SELECT '11111111-1111-1111-1111-111111111111', p.id, NULL, 'ativa', DATE '2026-01-01',
       'Plano Interna (decisão B, 23/10/2026)', NULL
  FROM public.planos p
 WHERE p.codigo = 'interna'
   AND EXISTS (SELECT 1 FROM public.empresas WHERE id = '11111111-1111-1111-1111-111111111111')
   AND NOT EXISTS (SELECT 1 FROM public.assinaturas WHERE empresa_id = '11111111-1111-1111-1111-111111111111');
INSERT INTO public.assinaturas (empresa_id, plano_id, valor_mensal, status, vigencia_inicio, gratis_ate,
                                proximo_vencimento, observacoes, created_by)
SELECT 'f1b06dbe-39dc-4344-89f7-dd27a68046d8', p.id, NULL, 'trial', DATE '2026-10-03', DATE '2027-01-02',
       DATE '2027-01-03', 'Nexa Gestão: 3 meses grátis desde o início do contrato (decisão B, 23/10/2026)', NULL
  FROM public.planos p
 WHERE p.codigo = 'nexa_gestao'
   AND EXISTS (SELECT 1 FROM public.empresas WHERE id = 'f1b06dbe-39dc-4344-89f7-dd27a68046d8')
   AND NOT EXISTS (SELECT 1 FROM public.assinaturas WHERE empresa_id = 'f1b06dbe-39dc-4344-89f7-dd27a68046d8');

-- ================================================================ vendido por
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS vendido_por text;
DO $$
BEGIN
  ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_vendido_por_check
    CHECK (vendido_por IN ('nexa', 'empresa'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Equipe Nexa = atendente da Nexa ou a Alice (IA); o resto é equipe da empresa.
CREATE OR REPLACE FUNCTION private.os_vendido_por()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.vendido_por := CASE WHEN EXISTS (
      SELECT 1 FROM public.salespeople s
       WHERE s.id = NEW.salesperson_id AND s.empresa_id = NEW.empresa_id
         AND (s.atendente_nexa OR s.eh_ia)) THEN 'nexa' ELSE 'empresa' END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.os_vendido_por() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_work_orders_vendido_por ON public.work_orders;
CREATE TRIGGER trg_work_orders_vendido_por
  BEFORE INSERT OR UPDATE OF salesperson_id, vendido_por ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION private.os_vendido_por();

-- OS existentes: pela vendedora atual, sem mexer em updated_at.
ALTER TABLE public.work_orders DISABLE TRIGGER trg_wo_upd;
UPDATE public.work_orders w
   SET vendido_por = CASE WHEN EXISTS (
         SELECT 1 FROM public.salespeople s
          WHERE s.id = w.salesperson_id AND s.empresa_id = w.empresa_id
            AND (s.atendente_nexa OR s.eh_ia)) THEN 'nexa' ELSE 'empresa' END
 WHERE w.vendido_por IS NULL;
ALTER TABLE public.work_orders ENABLE TRIGGER trg_wo_upd;

-- ================================================================ % vigente na data da venda
CREATE OR REPLACE FUNCTION private.comissao_nexa_pct(_empresa_id uuid, _data date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.percentual FROM public.contratos_comissao c
   WHERE c.empresa_id = _empresa_id AND c.vigencia_inicio <= _data
     AND (c.vigencia_fim IS NULL OR c.vigencia_fim >= _data)
   ORDER BY c.vigencia_inicio DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.comissao_nexa_pct(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.comissao_nexa_pct(uuid, date) TO service_role;
