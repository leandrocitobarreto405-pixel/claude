-- Terceirizados (decisão de 18/10, revista em 26/10): o cliente vê e paga o valor cheio; a
-- comissão é sobre o valor cheio; faturamento e lucro contam só o líquido (cheio − repasse).
-- 1. Limpeza ou impermeabilização pela descrição da linha ("— Limpeza" / "— Impermeabilização"),
--    não pelo tipo do atendimento: numa OS de impermeabilização, a limpeza do tapete feita pelo
--    parceiro tem repasse. Impermeabilização de tapete é feita pela empresa: nunca tem repasse,
--    mesmo com custo preenchido na tabela.
-- 2. Comissão prevista e realizada da OS sobre o valor cheio (antes o banco descontava o repasse):
--    vale o que o app grava, como em qualquer OS.
-- 3. Repasse da linha editável pelo admin (preço negociado diferente): fica marcado como editado
--    e não muda quando o custo da tabela muda.
-- 4. Custo novo na tabela: atualizar as OS não concluídas (pergunta na tela); concluídas ficam.

ALTER TABLE public.service_items
  ADD COLUMN IF NOT EXISTS repasse_editado boolean NOT NULL DEFAULT false;

-- Linha de impermeabilização? Pela descrição ("— Impermeabilização" / "— Limpeza"); sem sufixo,
-- pelo tipo do atendimento.
CREATE OR REPLACE FUNCTION private.linha_impermeabilizacao(_descricao text, _visita uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  imper boolean;
BEGIN
  IF coalesce(_descricao, '') ILIKE '%— imperm%' THEN RETURN true; END IF;
  IF coalesce(_descricao, '') ILIKE '%— limp%' OR coalesce(_descricao, '') ILIKE '%— higien%' THEN
    RETURN false;
  END IF;
  SELECT coalesce(st.name ILIKE 'imperm%', false) INTO imper
    FROM public.visits v LEFT JOIN public.config_options st ON st.id = v.service_type_id
   WHERE v.id = _visita;
  RETURN coalesce(imper, false);
END $$;
REVOKE ALL ON FUNCTION private.linha_impermeabilizacao(text, uuid) FROM PUBLIC, anon, authenticated;

-- A linha tem repasse? Item terceirizado, menos a impermeabilização de tapete (feita pela própria
-- empresa: sem parceiro, mesmo com custo preenchido na tabela; a tela avisa).
CREATE OR REPLACE FUNCTION private.linha_terceirizada(_item uuid, _descricao text, _visita uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT t.terceirizado
                      AND NOT (t.categoria = 'tapete' AND private.linha_impermeabilizacao(_descricao, _visita))
                     FROM public.tabela_precos_itens t WHERE t.id = _item), false);
$$;
REVOKE ALL ON FUNCTION private.linha_terceirizada(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- Custo do parceiro de uma linha (por unidade).
CREATE OR REPLACE FUNCTION private.custo_parceiro_da_linha(_item uuid, _descricao text, _visita uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT private.linha_terceirizada(_item, _descricao, _visita) THEN NULL
              WHEN private.linha_impermeabilizacao(_descricao, _visita) THEN t.custo_parceiro_impermeabilizacao
              ELSE t.custo_parceiro END
    FROM public.tabela_precos_itens t WHERE t.id = _item;
$$;
REVOKE ALL ON FUNCTION private.custo_parceiro_da_linha(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- Congela o custo do parceiro ao criar a linha (ou ao trocar a descrição/o item).
CREATE OR REPLACE FUNCTION private.service_item_terceirizado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item public.tabela_precos_itens%ROWTYPE;
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
  IF NOT FOUND OR NOT private.linha_terceirizada(item.id, NEW.description, NEW.visit_id) THEN
    NEW.custo_parceiro_unitario := NULL;
    NEW.parceiro_id := NULL;
    NEW.repasse_editado := false;
    RETURN NEW;
  END IF;

  -- Repasse editado à mão nesta linha: mantém (só troca se o item mudou).
  IF TG_OP = 'UPDATE' AND OLD.repasse_editado
     AND NEW.tabela_preco_item_id IS NOT DISTINCT FROM OLD.tabela_preco_item_id THEN
    RETURN NEW;
  END IF;
  NEW.custo_parceiro_unitario := private.custo_parceiro_da_linha(item.id, NEW.description, NEW.visit_id);
  NEW.parceiro_id := item.parceiro_id;
  NEW.repasse_editado := false;
  RETURN NEW;
END $$;

-- Comissão da OS sobre o valor cheio (o repasse não sai da base): a OS com terceirizado fica com a
-- comissão que o app grava, igual a qualquer OS. Os nomes ficam (gatilho e sincronizador chamam).
CREATE OR REPLACE FUNCTION private.trg_os_comissao_liquida()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.recalcular_comissao_os(_os uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Repasse mudou: a comissão não muda (é sobre o valor cheio).
  RETURN;
END $$;

CREATE OR REPLACE FUNCTION private.comissao_liquida_os(
  _os uuid, _total numeric, _pct numeric, OUT prevista numeric, OUT realizada numeric,
  OUT repasse numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  total_ativo numeric;
  base_concluida numeric;
  negociado numeric;
  proporcao numeric;
BEGIN
  SELECT coalesce(sum(CASE WHEN coalesce(final_value, 0) > 0 THEN final_value
                           ELSE coalesce(visit_value, 0) END), 0),
         coalesce(sum(CASE WHEN status = 'Concluído' THEN
                        CASE WHEN coalesce(final_value, 0) > 0 THEN final_value
                             ELSE coalesce(visit_value, 0) END END), 0),
         coalesce(sum(repasse_parceiro), 0)
    INTO total_ativo, base_concluida, repasse
    FROM public.visits
   WHERE work_order_id = _os AND status IS DISTINCT FROM 'Cancelado';
  negociado := coalesce(nullif(_total, 0), round(total_ativo, 2));
  proporcao := CASE WHEN total_ativo > 0 THEN base_concluida / total_ativo ELSE 0 END;
  prevista := round(negociado * coalesce(_pct, 0) / 100, 2);
  realizada := round(negociado * proporcao * coalesce(_pct, 0) / 100, 2);
END $$;

-- Repasse de uma linha editado pelo admin da empresa (custo por unidade daquela OS).
CREATE OR REPLACE FUNCTION public.editar_repasse_linha(_linha uuid, _custo_unitario numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.service_items%ROWTYPE;
BEGIN
  SELECT * INTO l FROM public.service_items WHERE id = _linha;
  IF NOT FOUND OR l.empresa_id IS DISTINCT FROM private.empresa_ativa() OR NOT private.tem_papel('admin') THEN
    RAISE EXCEPTION 'Só o administrador da empresa edita o repasse.' USING ERRCODE = '42501';
  END IF;
  IF l.parceiro_id IS NULL AND l.custo_parceiro_unitario IS NULL THEN
    RAISE EXCEPTION 'Esta linha não é de serviço terceirizado.' USING ERRCODE = '22023';
  END IF;
  IF _custo_unitario IS NULL OR _custo_unitario < 0 THEN
    RAISE EXCEPTION 'Informe o custo do parceiro (pode ser zero).' USING ERRCODE = '22023';
  END IF;
  UPDATE public.service_items
     SET custo_parceiro_unitario = round(_custo_unitario, 2), repasse_editado = true
   WHERE id = _linha;
  RETURN (SELECT repasse_parceiro FROM public.service_items WHERE id = _linha);
END $$;
REVOKE ALL ON FUNCTION public.editar_repasse_linha(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editar_repasse_linha(uuid, numeric) TO authenticated;

-- Linhas de OS não concluídas com o item (para perguntar se atualiza com o custo novo).
CREATE OR REPLACE FUNCTION private.linhas_abertas_do_item(_item uuid)
RETURNS TABLE (linha uuid, os_number text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT si.id, wo.os_number::text
    FROM public.service_items si
    JOIN public.visits v ON v.id = si.visit_id
    JOIN public.work_orders wo ON wo.id = v.work_order_id
   WHERE si.tabela_preco_item_id = _item AND si.active AND NOT si.repasse_editado
     AND private.linha_terceirizada(_item, si.description, si.visit_id)
     AND v.status NOT IN ('Concluído', 'Cancelado') AND wo.deleted_at IS NULL
     AND wo.status IS DISTINCT FROM 'Cancelada';
$$;
REVOKE ALL ON FUNCTION private.linhas_abertas_do_item(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.os_abertas_do_item(_item uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tabela_precos_itens t
                  WHERE t.id = _item AND t.empresa_id = private.empresa_ativa()) THEN
    RAISE EXCEPTION 'Item de outra empresa.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT jsonb_build_object('linhas', count(*), 'os', coalesce(jsonb_agg(DISTINCT os_number), '[]'::jsonb))
            FROM private.linhas_abertas_do_item(_item));
END $$;
REVOKE ALL ON FUNCTION public.os_abertas_do_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.os_abertas_do_item(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.atualizar_repasse_os_abertas(_item uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.tabela_precos_itens%ROWTYPE;
  n integer;
BEGIN
  SELECT * INTO t FROM public.tabela_precos_itens WHERE id = _item;
  IF NOT FOUND OR t.empresa_id IS DISTINCT FROM private.empresa_ativa() OR NOT private.tem_papel('admin') THEN
    RAISE EXCEPTION 'Só o administrador da empresa atualiza as OS.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.service_items si
     SET custo_parceiro_unitario = private.custo_parceiro_da_linha(t.id, si.description, si.visit_id),
         parceiro_id = CASE WHEN private.linha_terceirizada(t.id, si.description, si.visit_id)
                            THEN t.parceiro_id END
   WHERE si.id IN (SELECT linha FROM private.linhas_abertas_do_item(_item));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.atualizar_repasse_os_abertas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atualizar_repasse_os_abertas(uuid) TO authenticated;
