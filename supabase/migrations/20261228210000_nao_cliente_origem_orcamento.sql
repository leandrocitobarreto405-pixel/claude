-- "Não é cliente", cliente antigo e origem do orçamento (28/10).
-- 1) crm_leads.orcamento_origem: de onde veio o orçamento ('app' = cartão do app, 'conversa' =
--    preço escrito na conversa, 'os' = OS criada sem orçamento). Vazio = como antes (app).
-- 2) whatsapp_contacts.nao_cliente_*: contato marcado como não cliente (spam, parceria,
--    fornecedor, vendedor, propaganda). Sai do funil, das métricas, do "Precisa de você", dos
--    toques e das listas de marketing; desfazer = limpar as colunas.
-- 3) Motivos "Não é cliente" e "Cliente antigo / pós-venda" (não contam nas métricas, como
--    "Duplicado/teste") em todas as empresas, e nas novas pela função dos motivos.
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS orcamento_origem text
    CHECK (orcamento_origem IN ('app', 'conversa', 'os'));

ALTER TABLE public.whatsapp_contacts
  ADD COLUMN IF NOT EXISTS nao_cliente_em timestamptz,
  ADD COLUMN IF NOT EXISTS nao_cliente_motivo text CHECK (length(nao_cliente_motivo) <= 200),
  ADD COLUMN IF NOT EXISTS nao_cliente_por uuid;

CREATE OR REPLACE FUNCTION private.garantir_motivos_nao_conta(_emp uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.config_options (empresa_id, kind, name, display_order, active, metadata)
  SELECT _emp, 'crm_loss_reason', m.nome, 100 + m.ordem, true,
         jsonb_build_object('sem_desfecho', true, 'ordem', m.ordem, 'nao_conta', true) || m.extra
    FROM (VALUES
      (12, 'Não é cliente', '{"nao_cliente": true}'::jsonb),
      (13, 'Cliente antigo / pós-venda', '{"cliente_antigo": true}'::jsonb)
    ) AS m(ordem, nome, extra)
   WHERE NOT EXISTS (SELECT 1 FROM public.config_options o
                      WHERE o.empresa_id = _emp AND o.kind = 'crm_loss_reason' AND o.name = m.nome);
$$;
REVOKE ALL ON FUNCTION private.garantir_motivos_nao_conta(uuid) FROM PUBLIC, anon, authenticated;
SELECT private.garantir_motivos_nao_conta(e.id) FROM public.empresas e;

-- Empresas novas ganham os dois motivos junto com os do Sem desfecho.
CREATE OR REPLACE FUNCTION private.garantir_motivos_sem_desfecho(_emp uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.config_options (empresa_id, kind, name, display_order, active, metadata)
  SELECT _emp, 'crm_loss_reason', m.nome, 100 + m.ordem, true,
         jsonb_build_object('sem_desfecho', true, 'ordem', m.ordem) || m.extra
    FROM (VALUES
      (1, 'Agenda cheia', '{"pede_data": "desejada"}'::jsonb),
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
