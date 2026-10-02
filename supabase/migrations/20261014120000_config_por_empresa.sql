-- Configuração por empresa (Plano A, aprovado em 02/10/2026): nada fixo da Turbine Clean.
-- - Modelos de mensagem por finalidade (a Turbine continua com os nomes tc_; empresa nova usa
--   nomes neutros, editáveis). Cada empresa tem a própria conta do WhatsApp na Meta.
-- - Dias de disparo do marketing configuráveis (padrão: terça a quinta, como hoje).
-- - Descrição do negócio na Alice (antes fixa: "higienização e impermeabilização de estofados").
-- - Nome da própria empresa não vira "primeiro nome" de cliente.
-- - Empresa nova não copia mais taxas, margens, imposto, quilometragem e metas da empresa-modelo.
-- Funções trocadas só nos trechos fixos (o resto é igual ao que está em produção).

-- ================================================================ 1. colunas
ALTER TABLE public.ia_configuracoes
  ADD COLUMN IF NOT EXISTS descricao_negocio text NOT NULL DEFAULT ''
    CHECK (length(descricao_negocio) <= 2000);
UPDATE public.ia_configuracoes SET descricao_negocio = 'empresa de higienização e impermeabilização de estofados'
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111' AND descricao_negocio = '';

ALTER TABLE public.mkt_configuracoes
  ADD COLUMN IF NOT EXISTS modelos jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(modelos) = 'object'),
  ADD COLUMN IF NOT EXISTS dias_disparo smallint[] NOT NULL DEFAULT '{2,3,4}'
    CHECK (cardinality(dias_disparo) BETWEEN 1 AND 7 AND dias_disparo <@ '{1,2,3,4,5,6,7}'::smallint[]);
-- Turbine Clean: os nomes de hoje.
UPDATE public.mkt_configuracoes SET modelos = jsonb_build_object(
    'oferta', 'tc_oferta_trimestral', 'reativacao', 'tc_reativacao_cliente',
    'orcamento', 'tc_orcamento_retomada', 'higienizacao_6m', 'tc_higienizacao_6meses',
    'imper_13m', 'tc_imper_13meses', 'imper_13m_lembrete', 'tc_imper_13meses_lembrete',
    'posvenda', 'tc_posvenda_resultado', 'sazonal_prefixo', 'tc_sazonal_')
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111' AND modelos = '{}'::jsonb;

-- Empresa nova: modelo da promoção com nome neutro (a linha da Turbine continua tc_promocao_agenda).
ALTER TABLE public.agenda_configuracoes ALTER COLUMN promo_template_nome SET DEFAULT 'promocao_agenda';

-- ================================================================ 2. modelo por finalidade
CREATE OR REPLACE FUNCTION private.mkt_modelo(_emp uuid, _finalidade text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(nullif(btrim((SELECT c.modelos ->> _finalidade FROM public.mkt_configuracoes c
                                  WHERE c.empresa_id = _emp)), ''),
    CASE _finalidade
      WHEN 'oferta' THEN 'oferta_trimestral'
      WHEN 'reativacao' THEN 'reativacao_cliente'
      WHEN 'orcamento' THEN 'orcamento_retomada'
      WHEN 'higienizacao_6m' THEN 'higienizacao_6meses'
      WHEN 'imper_13m' THEN 'imper_13meses'
      WHEN 'imper_13m_lembrete' THEN 'imper_13meses_lembrete'
      WHEN 'posvenda' THEN 'posvenda_resultado'
      WHEN 'sazonal_prefixo' THEN 'sazonal_'
    END);
$$;
REVOKE ALL ON FUNCTION private.mkt_modelo(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mkt_modelo(uuid, text) TO service_role;

-- Modelo padrão do grupo, da empresa (a versão sem empresa continua existindo, sem uso).
CREATE OR REPLACE FUNCTION private.mkt_template_padrao(_emp uuid, _grupo text, _mes date)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE _grupo
    WHEN 'C4' THEN private.mkt_modelo(_emp, 'oferta')
    WHEN 'C5' THEN private.mkt_modelo(_emp, 'reativacao')
    WHEN 'N1' THEN private.mkt_modelo(_emp, 'orcamento')
    WHEN 'C2' THEN private.mkt_modelo(_emp, 'higienizacao_6m')
    WHEN 'C3' THEN private.mkt_modelo(_emp, 'imper_13m')
    ELSE private.mkt_modelo(_emp, 'sazonal_prefixo') ||
         (ARRAY['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'])
           [extract(month FROM _mes)::int]
  END;
$$;
REVOKE ALL ON FUNCTION private.mkt_template_padrao(uuid, text, date) FROM PUBLIC, anon, authenticated;

-- ================================================================ 3. dias de disparo
CREATE OR REPLACE FUNCTION private.mkt_proximo_dia_util(_data date, _dias smallint[])
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT min(d)::date FROM generate_series(_data, _data + 7, interval '1 day') d
   WHERE extract(isodow FROM d)::smallint = ANY (_dias);
$$;
REVOKE ALL ON FUNCTION private.mkt_proximo_dia_util(date, smallint[]) FROM PUBLIC, anon, authenticated;
