CREATE TYPE public.produto_tipo_servico AS ENUM ('higienizacao', 'impermeabilizacao');

CREATE TABLE public.produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  tipo_servico public.produto_tipo_servico NOT NULL,
  volume_embalagem_ml numeric NOT NULL CHECK (volume_embalagem_ml > 0),
  preco_pago numeric NOT NULL DEFAULT 0,
  custo_por_ml numeric GENERATED ALWAYS AS (preco_pago / volume_embalagem_ml) STORED,
  estoque_atual_ml numeric NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.produtos TO authenticated;
GRANT ALL ON public.produtos TO service_role;
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read produtos" ON public.produtos FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff insert produtos" ON public.produtos FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff update produtos" ON public.produtos FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff delete produtos" ON public.produtos FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));
CREATE TRIGGER trg_produtos_upd BEFORE UPDATE ON public.produtos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.os_produtos_utilizados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  produto_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL,
  produto_nome text NOT NULL DEFAULT '',
  quantidade_ml numeric NOT NULL CHECK (quantidade_ml > 0),
  custo_por_ml_snapshot numeric NOT NULL DEFAULT 0,
  custo_calculado numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_os_prod_wo ON public.os_produtos_utilizados (work_order_id);
CREATE INDEX idx_os_prod_visit ON public.os_produtos_utilizados (visit_id);
CREATE INDEX idx_os_prod_created ON public.os_produtos_utilizados (created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.os_produtos_utilizados TO authenticated;
GRANT ALL ON public.os_produtos_utilizados TO service_role;
ALTER TABLE public.os_produtos_utilizados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read consumo" ON public.os_produtos_utilizados FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff insert consumo" ON public.os_produtos_utilizados FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff update consumo" ON public.os_produtos_utilizados FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff delete consumo" ON public.os_produtos_utilizados FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.registrar_consumo_produto(
  _work_order_id uuid,
  _visit_id uuid,
  _produto_id uuid,
  _quantidade_ml numeric
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  p RECORD;
  novo_id uuid;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _quantidade_ml IS NULL OR _quantidade_ml <= 0 THEN
    RAISE EXCEPTION 'quantidade invalida';
  END IF;
  SELECT id, nome, custo_por_ml INTO p FROM public.produtos WHERE id = _produto_id;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'produto nao encontrado';
  END IF;

  INSERT INTO public.os_produtos_utilizados
    (work_order_id, visit_id, produto_id, produto_nome, quantidade_ml, custo_por_ml_snapshot, custo_calculado, created_by)
  VALUES
    (_work_order_id, _visit_id, p.id, p.nome, _quantidade_ml, COALESCE(p.custo_por_ml, 0),
     ROUND(COALESCE(p.custo_por_ml, 0) * _quantidade_ml, 2), auth.uid())
  RETURNING id INTO novo_id;

  UPDATE public.produtos
     SET estoque_atual_ml = GREATEST(estoque_atual_ml - _quantidade_ml, 0)
   WHERE id = p.id;

  RETURN novo_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_consumo_produto(uuid, uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_consumo_produto(uuid, uuid, uuid, numeric) TO authenticated;
