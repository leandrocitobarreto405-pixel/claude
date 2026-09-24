-- Catálogo de preços (nome diferente de service_items, que já é usado pelos itens de atendimento)
CREATE TABLE public.tabela_precos_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL DEFAULT '11111111-1111-1111-1111-111111111111'::uuid REFERENCES public.empresas(id),
  nome text NOT NULL,
  preco_higienizacao numeric(10,2) NOT NULL DEFAULT 0,
  preco_impermeabilizacao numeric(10,2),
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE public.quote_status AS ENUM ('rascunho','enviado','aprovado','recusado','convertido');
CREATE TYPE public.quote_tipo_servico AS ENUM ('higienizacao','impermeabilizacao');

CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL DEFAULT '11111111-1111-1111-1111-111111111111'::uuid REFERENCES public.empresas(id),
  cliente_nome text NOT NULL,
  cliente_telefone text,
  cliente_cep text,
  cliente_endereco text,
  customer_id uuid REFERENCES public.customers(id),
  data_servico date,
  observacoes text,
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  desconto numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  valor_a_vista numeric(10,2),
  km_ida_volta numeric(10,2) NOT NULL DEFAULT 0,
  custo_deslocamento numeric(10,2) NOT NULL DEFAULT 0,
  custo_produtos numeric(10,2) NOT NULL DEFAULT 0,
  custo_mao_obra numeric(10,2) NOT NULL DEFAULT 0,
  custo_total numeric(10,2) NOT NULL DEFAULT 0,
  margem_valor numeric(10,2) NOT NULL DEFAULT 0,
  margem_percentual numeric(6,2) NOT NULL DEFAULT 0,
  status public.quote_status NOT NULL DEFAULT 'rascunho',
  generated_work_order_id uuid REFERENCES public.work_orders(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL DEFAULT '11111111-1111-1111-1111-111111111111'::uuid REFERENCES public.empresas(id),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  tabela_preco_item_id uuid REFERENCES public.tabela_precos_itens(id),
  nome_snapshot text NOT NULL,
  tipo_servico public.quote_tipo_servico NOT NULL,
  preco_tabela numeric(10,2) NOT NULL DEFAULT 0,
  preco_aplicado numeric(10,2) NOT NULL DEFAULT 0,
  motivo_desconto text,
  quantidade integer NOT NULL DEFAULT 1,
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tabela_precos_empresa ON public.tabela_precos_itens(empresa_id, ordem);
CREATE INDEX idx_quotes_empresa_created ON public.quotes(empresa_id, created_at DESC);
CREATE INDEX idx_quote_items_quote ON public.quote_items(quote_id);
CREATE INDEX idx_quote_items_item ON public.quote_items(tabela_preco_item_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tabela_precos_itens TO authenticated;
GRANT ALL ON public.tabela_precos_itens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotes TO authenticated;
GRANT ALL ON public.quotes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_items TO authenticated;
GRANT ALL ON public.quote_items TO service_role;

ALTER TABLE public.tabela_precos_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY tabela_precos_tenant ON public.tabela_precos_itens FOR ALL TO authenticated
  USING (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())))
  WITH CHECK (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())));

CREATE POLICY quotes_tenant ON public.quotes FOR ALL TO authenticated
  USING (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())))
  WITH CHECK (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())));

CREATE POLICY quote_items_tenant ON public.quote_items FOR ALL TO authenticated
  USING (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())))
  WITH CHECK (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())));

CREATE TRIGGER trg_tabela_precos_upd BEFORE UPDATE ON public.tabela_precos_itens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_quotes_upd BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.tabela_precos_itens (empresa_id, nome, preco_higienizacao, preco_impermeabilizacao, ordem) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Colchão solteiro', 239.90, 527.90, 1),
  ('11111111-1111-1111-1111-111111111111', 'Colchão casal', 289.90, 637.90, 2),
  ('11111111-1111-1111-1111-111111111111', 'Colchão queen', 339.90, 747.90, 3),
  ('11111111-1111-1111-1111-111111111111', 'Colchão king', 389.90, 857.90, 4),
  ('11111111-1111-1111-1111-111111111111', 'Sofá comum 2 lugares (até 1,80m)', 239.90, 527.90, 5),
  ('11111111-1111-1111-1111-111111111111', 'Sofá comum 3 lugares (até 2,20m)', 289.90, 637.90, 6),
  ('11111111-1111-1111-1111-111111111111', 'Sofá retrátil 2 módulos (até 2,50m)', 329.90, 679.90, 7),
  ('11111111-1111-1111-1111-111111111111', 'Sofá retrátil 3 módulos (até 3,20m)', 389.90, 857.90, 8),
  ('11111111-1111-1111-1111-111111111111', 'Poltrona', 149.90, 329.90, 9),
  ('11111111-1111-1111-1111-111111111111', 'Puff / banqueta', 59.90, 131.90, 10),
  ('11111111-1111-1111-1111-111111111111', 'Cadeira de jantar — só assento', 29.90, 75.90, 11),
  ('11111111-1111-1111-1111-111111111111', 'Cadeira de jantar — assento+encosto', 59.90, 89.90, 12),
  ('11111111-1111-1111-1111-111111111111', 'Cabeceira de cama', 220.90, 485.90, 13);
