-- Desfaz 20261220120000_terceirizados_liquido (e as correções de dados da Turbine de 26/10).
-- Rodar inteiro, de uma vez. Nada é apagado: as funções novas ficam sem uso e o Diego fica inativo.

-- 1. Dados da Turbine: OS de outubro e persianas voltam como estavam. O gatilho que liga a linha
--    ao item da tabela fica parado só durante esta parte (senão ele religaria as linhas).
ALTER TABLE public.service_items DISABLE TRIGGER trg_service_items_terceirizado;
UPDATE public.service_items SET tabela_preco_item_id = NULL, custo_parceiro_unitario = NULL, parceiro_id = NULL
 WHERE id IN ('5300b31d-9477-40fc-b9f0-f39e653fb94a', '4f596023-cd1f-4d70-9d11-6f3669b761cb');
UPDATE public.service_items SET custo_parceiro_unitario = NULL
 WHERE id IN ('ff2e12fd-7347-4b31-9f56-38c40d883e67', '133b75c3-5f56-46f2-a725-14a0a28f0f5d');
ALTER TABLE public.service_items ENABLE TRIGGER trg_service_items_terceirizado;
UPDATE public.tabela_precos_itens SET parceiro_id = '7e4fde3b-0728-48bc-8aee-eb9aa07d0907'
 WHERE id IN ('a65d1cec-5a06-4982-a884-7908ce4111ab', 'ef12c400-2eec-41f7-b1a9-9f1818923505',
              '7b626cd2-a062-47c3-9d7d-db1d6f3daf5c', 'bfbe6722-6e33-439a-aa58-788eeec91dce');
UPDATE public.technicians SET active = false
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111' AND name = 'Diego' AND parceiro;
-- A despesa "Repasse a parceiro — OS 1685" (168,48) é cancelada sozinha quando o repasse volta a zero
-- (se ainda não tiver sido paga).

-- 2. Funções antigas (20261114120000 e 20261115120000).
CREATE OR REPLACE FUNCTION private.service_item_terceirizado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item public.tabela_precos_itens%ROWTYPE;
  imper boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.description IS NOT DISTINCT FROM OLD.description
       AND NEW.tabela_preco_item_id IS NOT DISTINCT FROM OLD.tabela_preco_item_id THEN
      RETURN NEW;
    END IF;
    -- Descrição trocada sem trocar o item: procura o item de novo.
    IF NEW.tabela_preco_item_id IS NOT DISTINCT FROM OLD.tabela_preco_item_id THEN
      NEW.tabela_preco_item_id := NULL;
    END IF;
  END IF;

  IF NEW.tabela_preco_item_id IS NULL AND NEW.description IS NOT NULL THEN
    NEW.tabela_preco_item_id := private.item_tabela_da_linha(NEW.empresa_id, NEW.description);
  END IF;

  SELECT * INTO item FROM public.tabela_precos_itens WHERE id = NEW.tabela_preco_item_id;
  IF NOT FOUND OR NOT item.terceirizado THEN
    NEW.custo_parceiro_unitario := NULL;
    NEW.parceiro_id := NULL;
    RETURN NEW;
  END IF;

  SELECT coalesce(st.name ILIKE 'imperm%', false) INTO imper
    FROM public.visits v LEFT JOIN public.config_options st ON st.id = v.service_type_id
   WHERE v.id = NEW.visit_id;
  imper := coalesce(imper, false) OR coalesce(NEW.description ILIKE '%— imperm%', false);

  NEW.custo_parceiro_unitario := CASE WHEN imper THEN item.custo_parceiro_impermeabilizacao
                                      ELSE item.custo_parceiro END;
  NEW.parceiro_id := item.parceiro_id;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.comissao_liquida_os(
  _os uuid, _total numeric, _pct numeric, OUT prevista numeric, OUT realizada numeric,
  OUT repasse numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  total_ativo numeric;
  base_concluida numeric;
  rep_concluido numeric;
  negociado numeric;
  proporcao numeric;
BEGIN
  SELECT coalesce(sum(CASE WHEN coalesce(final_value, 0) > 0 THEN final_value
                           ELSE coalesce(visit_value, 0) END), 0),
         coalesce(sum(CASE WHEN status = 'Concluído' THEN
                        CASE WHEN coalesce(final_value, 0) > 0 THEN final_value
                             ELSE coalesce(visit_value, 0) END END), 0),
         coalesce(sum(repasse_parceiro), 0),
         coalesce(sum(repasse_parceiro) FILTER (WHERE status = 'Concluído'), 0)
    INTO total_ativo, base_concluida, repasse, rep_concluido
    FROM public.visits
   WHERE work_order_id = _os AND status IS DISTINCT FROM 'Cancelado';
  negociado := coalesce(nullif(_total, 0), round(total_ativo, 2));
  proporcao := CASE WHEN total_ativo > 0 THEN base_concluida / total_ativo ELSE 0 END;
  prevista := round(greatest(0, negociado - repasse) * coalesce(_pct, 0) / 100, 2);
  realizada := round(greatest(0, negociado * proporcao - rep_concluido) * coalesce(_pct, 0) / 100, 2);
END $$;

CREATE OR REPLACE FUNCTION private.trg_os_comissao_liquida()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  c := private.comissao_liquida_os(NEW.id, NEW.total_gross_value, NEW.commission_percentage_snapshot);
  IF c.repasse > 0 THEN
    NEW.commission_expected := c.prevista;
    NEW.commission_realized := c.realizada;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.recalcular_comissao_os(_os uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w record;
  c record;
BEGIN
  SELECT id, total_gross_value, commission_percentage_snapshot INTO w
    FROM public.work_orders WHERE id = _os;
  IF NOT FOUND THEN RETURN; END IF;
  c := private.comissao_liquida_os(w.id, w.total_gross_value, w.commission_percentage_snapshot);
  UPDATE public.work_orders
     SET commission_expected = c.prevista, commission_realized = c.realizada
   WHERE id = _os
     AND (commission_expected IS DISTINCT FROM c.prevista
          OR commission_realized IS DISTINCT FROM c.realizada);
END $$;

-- 3. Funções novas sem acesso (ficam no banco, sem uso).
REVOKE EXECUTE ON FUNCTION public.editar_repasse_linha(uuid, numeric) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.os_abertas_do_item(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atualizar_repasse_os_abertas(uuid) FROM authenticated;
