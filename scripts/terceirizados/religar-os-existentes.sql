-- Terceirizados: liga as linhas de OS já existentes (tapete/persiana) ao item da tabela e congela
-- o custo do parceiro de HOJE. Rodar só depois de preencher o custo do parceiro em
-- Configurações › Tabela de preços. OS de teste, canceladas e excluídas ficam de fora.
-- Nada é apagado. Ao concluir o atendimento, a despesa "Repasse a parceiro" é criada sozinha.

-- 1) PRÉVIA (só leitura): o que muda em cada OS.
SELECT w.os_number, v.scheduled_date, v.status, si.description, si.quantity, si.subtotal AS cobrado,
       CASE WHEN st.name ILIKE 'imperm%' OR si.description ILIKE '%— imperm%'
            THEN t.custo_parceiro_impermeabilizacao ELSE t.custo_parceiro END AS custo_unitario,
       round(si.quantity * coalesce(CASE WHEN st.name ILIKE 'imperm%' OR si.description ILIKE '%— imperm%'
            THEN t.custo_parceiro_impermeabilizacao ELSE t.custo_parceiro END, 0), 2) AS repasse,
       si.subtotal - round(si.quantity * coalesce(CASE WHEN st.name ILIKE 'imperm%' OR si.description ILIKE '%— imperm%'
            THEN t.custo_parceiro_impermeabilizacao ELSE t.custo_parceiro END, 0), 2) AS liquido
  FROM public.service_items si
  JOIN public.visits v ON v.id = si.visit_id
  JOIN public.work_orders w ON w.id = v.work_order_id
  LEFT JOIN public.config_options st ON st.id = v.service_type_id
  JOIN public.tabela_precos_itens t
    ON t.id = private.item_tabela_da_linha(si.empresa_id, si.description) AND t.terceirizado
 WHERE si.active AND si.tabela_preco_item_id IS NULL
   AND NOT w.eh_teste AND w.deleted_at IS NULL AND w.status <> 'Cancelada'
 ORDER BY w.os_number;

-- 2) APLICAR (depois do ok): o gatilho congela o custo e recalcula o repasse do atendimento.
-- UPDATE public.service_items si
--    SET tabela_preco_item_id = private.item_tabela_da_linha(si.empresa_id, si.description)
--   FROM public.visits v JOIN public.work_orders w ON w.id = v.work_order_id
--  WHERE v.id = si.visit_id AND si.active AND si.tabela_preco_item_id IS NULL
--    AND NOT w.eh_teste AND w.deleted_at IS NULL AND w.status <> 'Cancelada'
--    AND EXISTS (SELECT 1 FROM public.tabela_precos_itens t
--                 WHERE t.id = private.item_tabela_da_linha(si.empresa_id, si.description)
--                   AND t.terceirizado);
