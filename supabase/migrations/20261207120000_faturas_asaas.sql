-- Fase B, item 3 (decisão G): faturas da assinatura pelo Asaas (sandbox primeiro). Esta parte não
-- depende da chave: as tabelas, as travas e o registro dos avisos (webhook) do Asaas.
-- 1. public.faturas: uma por assinatura e competência. Valor sempre maior que zero, e só para
--    assinatura com mensalidade definida (vazia ou R$ 0 não gera fatura: decisão de 23/10).
--    A empresa (admin) e a Nexa leem; quem grava é o servidor.
-- 2. public.pagamentos_eventos: cada aviso do Asaas, uma vez só (o id do evento não repete).
--    Só a Nexa lê.
-- 3. public.registrar_evento_pagamento(...): o servidor chama no webhook. Atualiza a fatura e a
--    assinatura: pagamento → fatura paga (inadimplente sem outra vencida volta a ativa);
--    vencida → fatura vencida e assinatura inadimplente desde o vencimento (o portão faz a
--    carência de 7 dias); apagada/estornada → fatura cancelada/estornada.
-- 4. configuracoes_plataforma.cobranca_emails_ativo = false: o e-mail de cobrança nasce DESLIGADO.
-- Nenhum dado existente muda.

-- ================================================================ 1. faturas
CREATE TABLE IF NOT EXISTS public.faturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  assinatura_id uuid NOT NULL REFERENCES public.assinaturas(id) ON DELETE CASCADE,
  -- Mês cobrado (sempre o dia 1).
  competencia date NOT NULL CHECK (extract(day FROM competencia) = 1),
  valor numeric(10,2) NOT NULL CHECK (valor > 0),
  vencimento date NOT NULL,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'paga', 'vencida', 'cancelada', 'estornada')),
  -- indefinida = quem paga escolhe (Pix, boleto ou cartão) no link do Asaas.
  forma text NOT NULL DEFAULT 'indefinida' CHECK (forma IN ('indefinida', 'pix', 'boleto', 'cartao')),
  gateway text NOT NULL DEFAULT 'asaas' CHECK (gateway IN ('asaas')),
  gateway_cobranca_id text UNIQUE,
  link_pagamento text,
  boleto_url text,
  pago_em date,
  valor_pago numeric(10,2),
  -- Nota fiscal (fica para depois: decisão G).
  nota_fiscal_status text NOT NULL DEFAULT 'nao_emitida'
    CHECK (nota_fiscal_status IN ('nao_emitida', 'agendada', 'emitida', 'cancelada', 'erro')),
  nota_fiscal_numero text,
  nota_fiscal_url text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Uma fatura valendo por assinatura e mês (cancelada ou estornada não conta).
CREATE UNIQUE INDEX IF NOT EXISTS faturas_uma_por_mes ON public.faturas (assinatura_id, competencia)
  WHERE status NOT IN ('cancelada', 'estornada');
CREATE INDEX IF NOT EXISTS idx_faturas_empresa ON public.faturas (empresa_id, vencimento DESC);

ALTER TABLE public.faturas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.faturas FROM anon, authenticated;
GRANT SELECT ON public.faturas TO authenticated;
GRANT ALL ON public.faturas TO service_role;
DROP POLICY IF EXISTS faturas_select ON public.faturas;
CREATE POLICY faturas_select ON public.faturas FOR SELECT TO authenticated
  USING ((SELECT private.is_nexa_admin()) OR private.tem_papel_na_empresa(empresa_id, 'admin'));
DROP TRIGGER IF EXISTS trg_faturas_upd ON public.faturas;
CREATE TRIGGER trg_faturas_upd BEFORE UPDATE ON public.faturas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- A fatura é da mesma empresa da assinatura, e assinatura sem mensalidade não gera fatura.
CREATE OR REPLACE FUNCTION private.faturas_conferir()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  emp uuid;
  mensal numeric;
BEGIN
  SELECT a.empresa_id, coalesce(a.valor_mensal, p.preco_mensal) INTO emp, mensal
    FROM public.assinaturas a JOIN public.planos p ON p.id = a.plano_id
   WHERE a.id = NEW.assinatura_id;
  IF emp IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION 'Fatura de outra empresa.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' AND coalesce(mensal, 0) <= 0 THEN
    RAISE EXCEPTION 'Assinatura sem mensalidade definida (vazia ou R$ 0) não gera fatura.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.faturas_conferir() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_faturas_conferir ON public.faturas;
CREATE TRIGGER trg_faturas_conferir BEFORE INSERT OR UPDATE OF empresa_id, assinatura_id ON public.faturas
  FOR EACH ROW EXECUTE FUNCTION private.faturas_conferir();

-- ================================================================ 2. eventos do Asaas
CREATE TABLE IF NOT EXISTS public.pagamentos_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway text NOT NULL DEFAULT 'asaas' CHECK (gateway IN ('asaas')),
  evento_id text NOT NULL,
  evento text NOT NULL,
  cobranca_id text,
  -- Preenchidos quando a cobrança é de uma fatura nossa.
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  fatura_id uuid REFERENCES public.faturas(id) ON DELETE SET NULL,
  resultado text NOT NULL DEFAULT 'recebido'
    CHECK (resultado IN ('recebido', 'processado', 'ignorado', 'sem_fatura')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gateway, evento_id)
);
CREATE INDEX IF NOT EXISTS idx_pagamentos_eventos_recentes ON public.pagamentos_eventos (recebido_em DESC);
ALTER TABLE public.pagamentos_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pagamentos_eventos FROM anon, authenticated;
GRANT SELECT ON public.pagamentos_eventos TO authenticated;
GRANT ALL ON public.pagamentos_eventos TO service_role;
DROP POLICY IF EXISTS pagamentos_eventos_nexa ON public.pagamentos_eventos;
CREATE POLICY pagamentos_eventos_nexa ON public.pagamentos_eventos FOR SELECT TO authenticated
  USING ((SELECT private.is_nexa_admin()));

-- ================================================================ 3. registrar o aviso
CREATE OR REPLACE FUNCTION public.registrar_evento_pagamento(
  _evento_id text, _evento text, _cobranca_id text, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ev uuid;
  f public.faturas%ROWTYPE;
  pg jsonb := coalesce(_payload -> 'payment', '{}'::jsonb);
  novo text;
  res text := 'processado';
BEGIN
  IF nullif(btrim(coalesce(_evento_id, '')), '') IS NULL OR nullif(btrim(coalesce(_evento, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Evento sem id ou sem tipo.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.pagamentos_eventos (evento_id, evento, cobranca_id, payload)
  VALUES (_evento_id, _evento, _cobranca_id, coalesce(_payload, '{}'::jsonb))
  ON CONFLICT (gateway, evento_id) DO NOTHING
  RETURNING id INTO ev;
  IF ev IS NULL THEN
    RETURN jsonb_build_object('resultado', 'duplicado');
  END IF;

  SELECT * INTO f FROM public.faturas WHERE gateway_cobranca_id = _cobranca_id FOR UPDATE;
  IF f.id IS NULL THEN
    UPDATE public.pagamentos_eventos SET resultado = 'sem_fatura' WHERE id = ev;
    RETURN jsonb_build_object('resultado', 'sem_fatura');
  END IF;

  novo := CASE
    WHEN _evento IN ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH') THEN 'paga'
    WHEN _evento = 'PAYMENT_OVERDUE' THEN 'vencida'
    WHEN _evento = 'PAYMENT_DELETED' THEN 'cancelada'
    WHEN _evento IN ('PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_DONE') THEN 'estornada'
    WHEN _evento = 'PAYMENT_RESTORED' THEN 'pendente'
  END;
  -- Pagamento que já chegou não volta para vencida (aviso atrasado ou fora de ordem).
  IF novo = 'vencida' AND f.status = 'paga' THEN novo := NULL; END IF;

  IF novo IS NULL THEN
    res := 'ignorado';
  ELSE
    UPDATE public.faturas SET
      status = novo,
      pago_em = CASE WHEN novo = 'paga'
                     THEN coalesce(nullif(pg ->> 'paymentDate', '')::date,
                                   nullif(pg ->> 'clientPaymentDate', '')::date, private.hoje_sp())
                     ELSE pago_em END,
      valor_pago = CASE WHEN novo = 'paga' THEN coalesce(nullif(pg ->> 'value', '')::numeric, valor)
                        ELSE valor_pago END,
      forma = CASE pg ->> 'billingType' WHEN 'PIX' THEN 'pix' WHEN 'BOLETO' THEN 'boleto'
                                        WHEN 'CREDIT_CARD' THEN 'cartao' ELSE forma END,
      link_pagamento = coalesce(nullif(pg ->> 'invoiceUrl', ''), link_pagamento),
      boleto_url = coalesce(nullif(pg ->> 'bankSlipUrl', ''), boleto_url)
    WHERE id = f.id;

    IF novo = 'paga' THEN
      -- Pagou e não tem outra vencida: sai da inadimplência.
      UPDATE public.assinaturas a SET status = 'ativa', inadimplente_desde = NULL
       WHERE a.id = f.assinatura_id AND a.status = 'inadimplente'
         AND NOT EXISTS (SELECT 1 FROM public.faturas o
                          WHERE o.assinatura_id = f.assinatura_id AND o.status = 'vencida');
    ELSIF novo = 'vencida' THEN
      -- Só assinatura com mensalidade (o gatilho de assinaturas recusa as outras: fica como está).
      BEGIN
        UPDATE public.assinaturas a SET status = 'inadimplente',
               inadimplente_desde = coalesce(a.inadimplente_desde, f.vencimento)
         WHERE a.id = f.assinatura_id AND a.status IN ('ativa', 'trial');
      EXCEPTION WHEN invalid_parameter_value THEN
        NULL;
      END;
    END IF;
  END IF;

  UPDATE public.pagamentos_eventos SET resultado = res, empresa_id = f.empresa_id, fatura_id = f.id
   WHERE id = ev;
  RETURN jsonb_build_object('resultado', res, 'fatura_id', f.id, 'status', coalesce(novo, f.status));
END $$;
REVOKE ALL ON FUNCTION public.registrar_evento_pagamento(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_evento_pagamento(text, text, text, jsonb) TO service_role;

-- ================================================================ 4. e-mail de cobrança desligado
INSERT INTO public.configuracoes_plataforma (chave, valor, descricao) VALUES
  ('cobranca_emails_ativo', 'false', 'E-mail de cobrança da assinatura (fatura vencida) para o admin da empresa')
ON CONFLICT (chave) DO NOTHING;

-- Trava de somente leitura nas tabelas novas (só o servidor grava nelas; fica pelo padrão).
SELECT private.instalar_travas_somente_leitura();
