-- Gerente comercial, fase 1 (29/10/2026). Só leitura das conversas: nada é enviado a cliente e nada
-- muda na Alice (ia_configuracoes). Tudo por empresa; ligado só na Turbine.
-- 1. "Agenda cheia" passa a se chamar "Agenda cheia / sem manhã livre" (mesmo id, em todas as
--    empresas que têm o motivo), para não dividir os números. Os motivos padrão das empresas novas e
--    o relatório de perdas por motivo acompanham o nome novo.
-- 2. "Pediu encaixe" no lead (encaixe_pedido_em, encaixe_obs, encaixe_por) e a função para marcar.
-- 3. comercial_configuracoes (ligado, teto em US$, rotina diária desligada), comercial_lotes (pedidos
--    de análise, retomáveis), comercial_analises (a ficha de cada lead, com tokens e custo) e
--    comercial_relatorios. Só o admin da empresa lê; quem grava é o servidor.
-- 4. Confirmar perda: nada vira perdido sem clique. comercial_confirmar_perda usa o registrar_desfecho
--    que já existe e guarda quem confirmou e se trocou o motivo; comercial_nao_perdeu só marca a ficha.
-- Nada existente é apagado.

-- 1. Motivo "Agenda cheia" renomeado ------------------------------------------------------------
UPDATE public.config_options
   SET name = 'Agenda cheia / sem manhã livre'
 WHERE kind = 'crm_loss_reason' AND name = 'Agenda cheia';

CREATE OR REPLACE FUNCTION private.garantir_motivos_sem_desfecho(_emp uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.config_options (empresa_id, kind, name, display_order, active, metadata)
  SELECT _emp, 'crm_loss_reason', m.nome, 100 + m.ordem, true,
         jsonb_build_object('sem_desfecho', true, 'ordem', m.ordem) || m.extra
    FROM (VALUES
      (1, 'Agenda cheia / sem manhã livre', '{"pede_data": "desejada"}'::jsonb),
      (2, 'Preço alto – fechou com outra empresa', '{}'::jsonb),
      (3, 'Preço alto – desistiu/adiou', '{}'::jsonb),
      (4, 'Fechou com outra empresa (motivo não informado)', '{}'::jsonb),
      (5, 'Não respondeu depois dos follow-ups', '{}'::jsonb),
      (6, 'Adiou', '{"pede_data": "retorno", "adiou": true}'::jsonb),
      (7, 'Fora da área', '{}'::jsonb),
      (8, 'Não precisa mais', '{}'::jsonb),
      (9, 'Só cotando', '{}'::jsonb),
      (10, 'Serviço que não fazemos', '{}'::jsonb),
      (11, 'Duplicado/teste', '{"nao_conta": true}'::jsonb)
    ) AS m(ordem, nome, extra)
   WHERE NOT EXISTS (SELECT 1 FROM public.config_options o
                      WHERE o.empresa_id = _emp AND o.kind = 'crm_loss_reason'
                        AND (o.metadata->>'sem_desfecho')::boolean IS TRUE);
  PERFORM private.garantir_motivos_nao_conta(_emp);
END $$;
REVOKE ALL ON FUNCTION private.garantir_motivos_sem_desfecho(uuid) FROM PUBLIC, anon, authenticated;

-- Relatório de perdas: o bloco "agenda cheia por serviço" aceita o nome novo (e o antigo).
CREATE OR REPLACE FUNCTION public.perdas_por_motivo(_de date, _ate date, _origem uuid DEFAULT NULL::uuid, _servico text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE emp uuid := private.empresa_ativa();
BEGIN
  IF emp IS NULL OR NOT (private.tem_papel('admin') OR private.tem_papel('atendente')) THEN
    RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501';
  END IF;
  RETURN (
    WITH base AS (
      SELECT l.id, o.name AS motivo, coalesce((o.metadata->>'nao_conta')::boolean, false) AS nao_conta,
             o.display_order, coalesce(q.total, 0) AS valor, coalesce(q.servicos, l.service_interest, 'Sem serviço') AS servico,
             CASE WHEN l.data_desejada IS NOT NULL
                  THEN l.data_desejada - (coalesce(l.desfecho_em, l.perdido_em) AT TIME ZONE 'America/Sao_Paulo')::date END AS dias_frente
        FROM public.crm_leads l
        JOIN public.config_options o ON o.id = l.loss_reason_id
        LEFT JOIN LATERAL (
          SELECT coalesce(qq.total, qq.valor_cartao) AS total,
                 (SELECT string_agg(DISTINCT qi.tipo_servico::text, ', ') FROM public.quote_items qi WHERE qi.quote_id = qq.id) AS servicos
            FROM public.quotes qq WHERE qq.crm_lead_id = l.id ORDER BY qq.created_at DESC LIMIT 1) q ON true
       WHERE l.empresa_id = emp
         AND (coalesce(l.desfecho_em, l.perdido_em) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _de AND _ate
         AND (_origem IS NULL OR l.sales_origin_id = _origem)
         AND (_servico IS NULL OR coalesce(q.servicos, l.service_interest, '') ILIKE '%' || _servico || '%'))
    SELECT jsonb_build_object(
      'motivos', coalesce((SELECT jsonb_agg(jsonb_build_object('motivo', motivo, 'quantidade', n, 'valor', v, 'nao_conta', nao_conta) ORDER BY nao_conta, v DESC, n DESC)
                            FROM (SELECT motivo, nao_conta, count(*) AS n, sum(valor) AS v FROM base GROUP BY motivo, nao_conta) m), '[]'::jsonb),
      'total', jsonb_build_object('quantidade', (SELECT count(*) FROM base WHERE NOT nao_conta),
                                  'valor', (SELECT coalesce(sum(valor), 0) FROM base WHERE NOT nao_conta)),
      'agenda_cheia', coalesce((SELECT jsonb_agg(jsonb_build_object('servico', servico, 'quantidade', n, 'valor', v, 'dias_frente_media', d) ORDER BY n DESC)
                                 FROM (SELECT servico, count(*) AS n, sum(valor) AS v, round(avg(dias_frente)) AS d
                                         FROM base WHERE motivo IN ('Agenda cheia', 'Agenda cheia / sem manhã livre')
                                        GROUP BY servico) a), '[]'::jsonb))
  );
END $$;

-- 2. Pediu encaixe ---------------------------------------------------------------------------
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS encaixe_pedido_em timestamptz,
  ADD COLUMN IF NOT EXISTS encaixe_obs text CHECK (length(encaixe_obs) <= 300),
  ADD COLUMN IF NOT EXISTS encaixe_por uuid;
CREATE INDEX IF NOT EXISTS idx_crm_leads_encaixe ON public.crm_leads (empresa_id, encaixe_pedido_em)
  WHERE encaixe_pedido_em IS NOT NULL;

-- Marca (ou tira) o "pediu encaixe" de um lead da empresa ativa. Admin e atendente.
CREATE OR REPLACE FUNCTION public.marcar_encaixe(_lead uuid, _pediu boolean, _obs text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE emp uuid := private.empresa_ativa();
BEGIN
  IF emp IS NULL OR NOT (private.tem_papel('admin') OR private.tem_papel('atendente')) THEN
    RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501';
  END IF;
  UPDATE public.crm_leads
     SET encaixe_pedido_em = CASE WHEN _pediu THEN coalesce(encaixe_pedido_em, now()) END,
         encaixe_obs = CASE WHEN _pediu THEN left(nullif(trim(_obs), ''), 300) END,
         encaixe_por = CASE WHEN _pediu THEN auth.uid() END
   WHERE id = _lead AND empresa_id = emp;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.marcar_encaixe(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_encaixe(uuid, boolean, text) TO authenticated;

-- 3. Tabelas do gerente comercial -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comercial_configuracoes (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  ligado boolean NOT NULL DEFAULT false,
  teto_usd numeric(8,2) NOT NULL DEFAULT 15 CHECK (teto_usd >= 0),
  rotina_diaria boolean NOT NULL DEFAULT false,
  modelo text NOT NULL DEFAULT 'claude-sonnet-5-5',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.comercial_lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  descricao text NOT NULL DEFAULT '' CHECK (length(descricao) <= 200),
  leads uuid[] NOT NULL CHECK (cardinality(leads) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'rodando', 'concluido', 'parado_teto', 'cancelado', 'erro')),
  processados integer NOT NULL DEFAULT 0,
  com_erro integer NOT NULL DEFAULT 0,
  custo_usd numeric(10,5) NOT NULL DEFAULT 0,
  erro text,
  pedido_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  atualizado_em timestamptz,
  concluido_em timestamptz
);
CREATE INDEX IF NOT EXISTS idx_comercial_lotes_status ON public.comercial_lotes (status, pedido_em);

CREATE TABLE IF NOT EXISTS public.comercial_analises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  crm_lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  lote_id uuid REFERENCES public.comercial_lotes(id) ON DELETE SET NULL,
  grupo text NOT NULL CHECK (grupo IN ('google', 'outras')),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'ok', 'erro')),
  erro text,
  -- Fatos calculados pelo sistema (tempos, valores, quem atendeu, follow-ups) e a ficha da IA.
  fatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  ficha jsonb,
  -- Campos para filtrar (copiados da ficha e dos fatos).
  servico text,
  origem text,
  quem_atendeu text CHECK (quem_atendeu IN ('alice', 'equipe', 'alice_e_equipe', 'nao_identificado')),
  resultado text CHECK (resultado IN ('vendeu', 'perdeu', 'sem_desfecho', 'sem_orcamento')),
  valor_orcado numeric(12,2),
  valor_vendido numeric(12,2),
  nota smallint CHECK (nota BETWEEN 0 AND 10),
  motivo_sugerido_id uuid REFERENCES public.config_options(id) ON DELETE SET NULL,
  frase_cliente text,
  ainda_vale boolean,
  mensagem_sugerida text,
  pediu_encaixe boolean NOT NULL DEFAULT false,
  -- Custo da análise.
  modelo text,
  tokens_entrada integer NOT NULL DEFAULT 0,
  tokens_cache integer NOT NULL DEFAULT 0,
  tokens_saida integer NOT NULL DEFAULT 0,
  custo_usd numeric(10,5) NOT NULL DEFAULT 0,
  analisado_em timestamptz,
  -- Confirmação da perda (só com clique).
  perda_situacao text CHECK (perda_situacao IN ('confirmada', 'trocada', 'nao_perdeu')),
  perda_motivo_final_id uuid REFERENCES public.config_options(id) ON DELETE SET NULL,
  perda_por uuid,
  perda_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, crm_lead_id)
);
CREATE INDEX IF NOT EXISTS idx_comercial_analises_empresa ON public.comercial_analises (empresa_id, status, resultado);

CREATE TABLE IF NOT EXISTS public.comercial_relatorios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  periodo text NOT NULL CHECK (length(periodo) <= 60),
  dados jsonb NOT NULL,
  modelo text,
  tokens_entrada integer NOT NULL DEFAULT 0,
  tokens_saida integer NOT NULL DEFAULT 0,
  custo_usd numeric(10,5) NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comercial_relatorios_empresa ON public.comercial_relatorios (empresa_id, criado_em DESC);

-- Só o admin da empresa ativa lê (e a Nexa); quem grava é o servidor (service_role) e as funções abaixo.
DO $p$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['comercial_configuracoes', 'comercial_lotes', 'comercial_analises', 'comercial_relatorios'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_select') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ('
        '(empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel(''admin''))) '
        'OR (SELECT private.is_nexa_admin()))', t || '_select', t);
    END IF;
  END LOOP;
END $p$;

-- Ligado só na Turbine (teto US$ 15, rotina diária desligada).
INSERT INTO public.comercial_configuracoes (empresa_id, ligado)
SELECT id, true FROM public.empresas WHERE id = '11111111-1111-1111-1111-111111111111'
ON CONFLICT (empresa_id) DO NOTHING;

-- 4. Confirmar perda / ainda não perdeu -----------------------------------------------------
-- Confirma (ou troca) o motivo sugerido: registra o desfecho pelo caminho de sempre e guarda quem
-- confirmou e se trocou o motivo. Só admin.
CREATE OR REPLACE FUNCTION public.comercial_confirmar_perda(_analise uuid, _motivo uuid, _obs text DEFAULT NULL, _data date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  emp uuid := private.empresa_ativa();
  a public.comercial_analises;
  r jsonb;
BEGIN
  IF emp IS NULL OR NOT private.tem_papel('admin') THEN
    RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO a FROM public.comercial_analises WHERE id = _analise AND empresa_id = emp FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Análise não encontrada.'; END IF;
  IF a.perda_situacao IS NOT NULL THEN RAISE EXCEPTION 'Esta perda já foi respondida.'; END IF;
  r := public.registrar_desfecho(a.crm_lead_id, _motivo, _obs, _data);
  UPDATE public.comercial_analises
     SET perda_situacao = CASE WHEN _motivo IS NOT DISTINCT FROM a.motivo_sugerido_id THEN 'confirmada' ELSE 'trocada' END,
         perda_motivo_final_id = _motivo,
         perda_por = auth.uid(),
         perda_em = now(),
         updated_at = now()
   WHERE id = a.id;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.comercial_confirmar_perda(uuid, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comercial_confirmar_perda(uuid, uuid, text, date) TO authenticated;

-- "Ainda não perdeu": só a ficha registra a resposta; o lead não muda.
CREATE OR REPLACE FUNCTION public.comercial_nao_perdeu(_analise uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE emp uuid := private.empresa_ativa();
BEGIN
  IF emp IS NULL OR NOT private.tem_papel('admin') THEN
    RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501';
  END IF;
  UPDATE public.comercial_analises
     SET perda_situacao = 'nao_perdeu', perda_por = auth.uid(), perda_em = now(), updated_at = now()
   WHERE id = _analise AND empresa_id = emp AND perda_situacao IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Análise não encontrada ou já respondida.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.comercial_nao_perdeu(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comercial_nao_perdeu(uuid) TO authenticated;

SELECT private.instalar_travas_somente_leitura();
