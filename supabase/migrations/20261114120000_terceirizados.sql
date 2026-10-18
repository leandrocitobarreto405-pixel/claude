-- Serviços terceirizados (tapete e persiana na Turbine): o cliente paga o valor cheio, a
-- empresa repassa uma parte ao parceiro e só a receita líquida conta nos números.
-- Nada é apagado: só colunas novas (vazias/desligadas por padrão), gatilhos e funções novas.

-- 1. Técnico parceiro: não é da empresa, não tem login nem e-mail (sem convite, sem push,
--    sem convite da Agenda Google), não entra no custo de km nem nos horários da Alice.
ALTER TABLE public.technicians
  ADD COLUMN IF NOT EXISTS parceiro boolean NOT NULL DEFAULT false;
ALTER TABLE public.technicians DROP CONSTRAINT IF EXISTS technicians_parceiro_sem_acesso;
ALTER TABLE public.technicians ADD CONSTRAINT technicians_parceiro_sem_acesso
  CHECK (NOT parceiro OR (user_id IS NULL AND email IS NULL));

-- 2. Item da tabela de preços terceirizado: custo do parceiro por unidade do item (m² ou peça).
ALTER TABLE public.tabela_precos_itens
  ADD COLUMN IF NOT EXISTS terceirizado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custo_parceiro numeric(10,2) CHECK (custo_parceiro >= 0),
  ADD COLUMN IF NOT EXISTS custo_parceiro_impermeabilizacao numeric(10,2)
    CHECK (custo_parceiro_impermeabilizacao >= 0),
  ADD COLUMN IF NOT EXISTS parceiro_id uuid REFERENCES public.technicians(id);
DROP TRIGGER IF EXISTS trg_tabela_precos_itens_valida_parceiro ON public.tabela_precos_itens;
CREATE TRIGGER trg_tabela_precos_itens_valida_parceiro
  BEFORE INSERT OR UPDATE OF parceiro_id ON public.tabela_precos_itens
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias('parceiro_id', 'technicians');

-- 3. Linha da OS: item da tabela de origem e custo do parceiro congelado na venda.
ALTER TABLE public.service_items
  ADD COLUMN IF NOT EXISTS tabela_preco_item_id uuid
    REFERENCES public.tabela_precos_itens(id),
  ADD COLUMN IF NOT EXISTS custo_parceiro_unitario numeric(10,2)
    CHECK (custo_parceiro_unitario >= 0),
  ADD COLUMN IF NOT EXISTS parceiro_id uuid REFERENCES public.technicians(id);
ALTER TABLE public.service_items
  ADD COLUMN IF NOT EXISTS repasse_parceiro numeric(12,2)
    GENERATED ALWAYS AS (round(quantity * coalesce(custo_parceiro_unitario, 0), 2)) STORED;
-- Total do repasse do atendimento (soma das linhas ativas), para os painéis descontarem.
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS repasse_parceiro numeric(12,2) NOT NULL DEFAULT 0;
DROP TRIGGER IF EXISTS trg_service_items_valida_terceirizado ON public.service_items;
CREATE TRIGGER trg_service_items_valida_terceirizado
  BEFORE INSERT OR UPDATE OF tabela_preco_item_id, parceiro_id ON public.service_items
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias(
    'tabela_preco_item_id', 'tabela_precos_itens', 'parceiro_id', 'technicians');

-- Item da tabela que deu origem à linha: pelo id, se o app mandar, ou pelo nome no começo da
-- descrição ("<nome do item> — Limpeza"), que é como todas as telas e a Alice montam a linha.
CREATE OR REPLACE FUNCTION private.item_tabela_da_linha(_empresa uuid, _descricao text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id FROM public.tabela_precos_itens t
   WHERE t.empresa_id = _empresa
     AND length(t.nome) > 0
     AND left(_descricao, length(t.nome)) = t.nome
     AND (length(_descricao) = length(t.nome)
          OR substr(_descricao, length(t.nome) + 1, 2) = ' —')
   ORDER BY length(t.nome) DESC, t.ativo DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.item_tabela_da_linha(uuid, text) FROM PUBLIC, anon, authenticated;

-- Congela o custo do parceiro ao criar a linha (ou ao trocar a descrição/o item).
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
REVOKE ALL ON FUNCTION private.service_item_terceirizado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_service_items_terceirizado ON public.service_items;
CREATE TRIGGER trg_service_items_terceirizado
  BEFORE INSERT OR UPDATE OF description, tabela_preco_item_id ON public.service_items
  FOR EACH ROW EXECUTE FUNCTION private.service_item_terceirizado();

-- 4. Repasse ao parceiro como conta a pagar: uma despesa pendente por atendimento concluído,
--    vencendo na data da conclusão. Fica fora das despesas do DRE (a receita já entra líquida).
--    Atendimento reaberto ou sem repasse: a despesa ainda não paga é cancelada (nada apagado).
CREATE OR REPLACE FUNCTION private.sincronizar_repasse_parceiro(_visita uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v record;
  total numeric;
  parceiros text;
  chave text := 'repasse:' || _visita;
  atual public.expenses%ROWTYPE;
BEGIN
  SELECT vi.id, vi.empresa_id, vi.status, vi.completion_date, vi.work_order_id,
         wo.os_number, coalesce(wo.eh_teste, false) AS eh_teste, wo.deleted_at
    INTO v
    FROM public.visits vi JOIN public.work_orders wo ON wo.id = vi.work_order_id
   WHERE vi.id = _visita;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT coalesce(sum(si.repasse_parceiro), 0),
         string_agg(DISTINCT t.name, ', ')
    INTO total, parceiros
    FROM public.service_items si LEFT JOIN public.technicians t ON t.id = si.parceiro_id
   WHERE si.visit_id = _visita AND si.active AND si.repasse_parceiro > 0;

  UPDATE public.visits SET repasse_parceiro = total
   WHERE id = _visita AND repasse_parceiro IS DISTINCT FROM total;

  SELECT * INTO atual FROM public.expenses
   WHERE empresa_id = v.empresa_id AND reference_key = chave AND deleted_at IS NULL;

  IF v.status = 'Concluído' AND total > 0 AND NOT v.eh_teste AND v.deleted_at IS NULL THEN
    IF atual.id IS NULL THEN
      INSERT INTO public.expenses (
        empresa_id, description, category, competence_date, due_date, expected_amount,
        status, origin, beneficiary, work_order_id, reference_key, notes)
      VALUES (
        v.empresa_id, 'Repasse a parceiro — OS ' || v.os_number, 'Repasse a parceiro',
        coalesce(v.completion_date, current_date), coalesce(v.completion_date, current_date),
        total, 'Pendente', 'Repasse a parceiro', parceiros, v.work_order_id, chave,
        'Criada ao concluir o atendimento (itens terceirizados).');
    ELSIF coalesce(atual.paid_amount, 0) = 0 AND atual.status <> 'Pago' THEN
      UPDATE public.expenses
         SET expected_amount = total,
             competence_date = coalesce(v.completion_date, competence_date),
             due_date = coalesce(v.completion_date, due_date),
             beneficiary = parceiros,
             status = 'Pendente',
             updated_at = now()
       WHERE id = atual.id;
    END IF;
  ELSIF atual.id IS NOT NULL AND coalesce(atual.paid_amount, 0) = 0
        AND atual.status NOT IN ('Pago', 'Cancelado') THEN
    UPDATE public.expenses
       SET status = 'Cancelado',
           notes = coalesce(notes || ' ', '') || 'Cancelada: atendimento não concluído ou sem repasse.',
           updated_at = now()
     WHERE id = atual.id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.sincronizar_repasse_parceiro(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.trg_visita_repasse_parceiro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'Concluído' OR (TG_OP = 'UPDATE' AND OLD.status = 'Concluído') THEN
    PERFORM private.sincronizar_repasse_parceiro(NEW.id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.trg_visita_repasse_parceiro() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_visits_repasse_parceiro ON public.visits;
CREATE TRIGGER trg_visits_repasse_parceiro
  AFTER INSERT OR UPDATE OF status, completion_date ON public.visits
  FOR EACH ROW EXECUTE FUNCTION private.trg_visita_repasse_parceiro();

CREATE OR REPLACE FUNCTION private.trg_item_repasse_parceiro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.repasse_parceiro > 0
     OR (TG_OP = 'UPDATE' AND OLD.repasse_parceiro IS DISTINCT FROM NEW.repasse_parceiro)
     OR (TG_OP = 'UPDATE' AND OLD.active IS DISTINCT FROM NEW.active AND OLD.repasse_parceiro > 0) THEN
    PERFORM private.sincronizar_repasse_parceiro(NEW.visit_id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.trg_item_repasse_parceiro() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_service_items_repasse_parceiro ON public.service_items;
CREATE TRIGGER trg_service_items_repasse_parceiro
  AFTER INSERT OR UPDATE ON public.service_items
  FOR EACH ROW EXECUTE FUNCTION private.trg_item_repasse_parceiro();

-- 5. Turbine: tapete e persiana da tabela marcados como terceirizados (custo vazio até ser
--    preenchido; sem custo, o repasse fica zero e nada muda nos números). Outras empresas não mudam.
UPDATE public.tabela_precos_itens
   SET terceirizado = true
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
   AND categoria IN ('tapete', 'persiana') AND NOT terceirizado;
