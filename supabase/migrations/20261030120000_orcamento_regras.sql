-- Orçamento: regras de preço por empresa (todas desligadas por padrão), preço editável com
-- registro de quem editou, valores de vitrine e categoria dos itens da tabela de preços.
-- Só acrescenta: nenhuma tabela, coluna ou dado é apagado.

-- 1. Categoria do item da tabela: decide quem entra no desconto do item adicional (sofá e
--    colchão) e o mínimo de pedido só de cadeiras.
ALTER TABLE public.tabela_precos_itens
  ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'outro'
    CHECK (categoria IN ('sofa', 'colchao', 'cadeira', 'outro'));
UPDATE public.tabela_precos_itens
   SET categoria = CASE
     WHEN nome ILIKE 'sof%' THEN 'sofa'
     WHEN nome ILIKE 'colch%' THEN 'colchao'
     WHEN nome ILIKE 'cadeira%' THEN 'cadeira'
     ELSE 'outro' END
 WHERE categoria = 'outro';

-- 2. Regras de orçamento da empresa. Sem linha (ou tudo desligado): o orçamento fica como antes.
CREATE TABLE IF NOT EXISTS public.orcamento_configuracoes (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id),
  -- Item adicional: o principal (mais caro) com preço cheio; cada adicional das categorias com desconto.
  desconto_adicional_ligado boolean NOT NULL DEFAULT false,
  desconto_adicional_pct numeric(5,2) NOT NULL DEFAULT 40 CHECK (desconto_adicional_pct BETWEEN 0 AND 90),
  desconto_categorias text[] NOT NULL DEFAULT '{sofa,colchao}',
  -- Pedido só de cadeiras: valor mínimo (vazio = sem mínimo).
  minimo_cadeiras numeric(10,2) CHECK (minimo_cadeiras IS NULL OR minimo_cadeiras >= 0),
  -- "Muito sujo": acréscimo sobre o pedido inteiro.
  sujidade_ligado boolean NOT NULL DEFAULT false,
  sujidade_pct numeric(5,2) NOT NULL DEFAULT 10 CHECK (sujidade_pct BETWEEN 0 AND 100),
  -- Distância (só a ida, da base do técnico mais próximo): até X km sem acréscimo, de X a Y km com
  -- acréscimo, acima de Y km "fora da área".
  distancia_ligado boolean NOT NULL DEFAULT false,
  distancia_sem_acrescimo_km numeric(6,1) CHECK (distancia_sem_acrescimo_km IS NULL OR distancia_sem_acrescimo_km >= 0),
  distancia_limite_km numeric(6,1) CHECK (distancia_limite_km IS NULL OR distancia_limite_km >= 0),
  distancia_pct numeric(5,2) NOT NULL DEFAULT 10 CHECK (distancia_pct BETWEEN 0 AND 100),
  -- Vitrine: valor do estofado, boas-vindas (cliente novo) no cartão e Pix.
  vitrine_ligada boolean NOT NULL DEFAULT false,
  boas_vindas_pct numeric(5,2) NOT NULL DEFAULT 20 CHECK (boas_vindas_pct BETWEEN 0 AND 60),
  pix_pct numeric(5,2) NOT NULL DEFAULT 10 CHECK (pix_pct BETWEEN 0 AND 30),
  arredondamento text NOT NULL DEFAULT 'dezena_5' CHECK (arredondamento IN ('dezena_5', 'noventa')),
  -- Mensagem: parcelas e validade (vazio = as da configuração da Alice).
  parcelas_max int CHECK (parcelas_max IS NULL OR parcelas_max BETWEEN 1 AND 12),
  validade_dias int CHECK (validade_dias IS NULL OR validade_dias BETWEEN 1 AND 60),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orcamento_configuracoes_faixas CHECK (
    distancia_sem_acrescimo_km IS NULL OR distancia_limite_km IS NULL
    OR distancia_sem_acrescimo_km <= distancia_limite_km)
);
ALTER TABLE public.orcamento_configuracoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.orcamento_configuracoes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.orcamento_configuracoes TO authenticated;
GRANT ALL ON public.orcamento_configuracoes TO service_role;
CREATE POLICY orcamento_configuracoes_select ON public.orcamento_configuracoes FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));
CREATE POLICY orcamento_configuracoes_insert ON public.orcamento_configuracoes FOR INSERT TO authenticated
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
CREATE POLICY orcamento_configuracoes_update ON public.orcamento_configuracoes FOR UPDATE TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')))
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));

-- 3. Itens do orçamento: categoria, preço sugerido pelas regras, desconto da regra e quem editou.
--    preco_tabela (já existe) é o valor da tabela; preco_aplicado (já existe) é o valor final.
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS categoria text,
  ADD COLUMN IF NOT EXISTS preco_sugerido numeric(10,2),
  ADD COLUMN IF NOT EXISTS desconto_regra_valor numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desconto_regra_texto text,
  ADD COLUMN IF NOT EXISTS item_principal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS editado_por uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS editado_em timestamptz;

-- 4. Orçamento: cliente novo, adicionais, mínimo das cadeiras e valores de vitrine.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS cliente_novo boolean,
  ADD COLUMN IF NOT EXISTS muito_sujo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acrescimo_sujidade numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS distancia_km numeric(8,1),
  ADD COLUMN IF NOT EXISTS distancia_base text,
  ADD COLUMN IF NOT EXISTS acrescimo_distancia numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fora_da_area boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS minimo_aplicado numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_vitrine numeric(10,2),
  ADD COLUMN IF NOT EXISTS valor_cartao numeric(10,2),
  ADD COLUMN IF NOT EXISTS valor_pix numeric(10,2),
  ADD COLUMN IF NOT EXISTS valores_editados_por uuid REFERENCES auth.users(id);

-- 5. Itens da OS: valor da tabela e quem editou (selo "editado" na OS).
ALTER TABLE public.service_items
  ADD COLUMN IF NOT EXISTS preco_tabela numeric(10,2),
  ADD COLUMN IF NOT EXISTS editado_por uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS editado_em timestamptz;
