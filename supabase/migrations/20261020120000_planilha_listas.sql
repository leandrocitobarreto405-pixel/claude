-- Planilha diária das listas ("Nexa OS — Listas", no Drive da conta Google da empresa): id da
-- planilha e data da última atualização, e a leitura das listas pela rotina das 9h (chave de
-- serviço, sem usuário logado).

ALTER TABLE public.mkt_configuracoes
  ADD COLUMN IF NOT EXISTS planilha_listas_id text,
  ADD COLUMN IF NOT EXISTS planilha_listas_atualizada_em timestamptz;
COMMENT ON COLUMN public.mkt_configuracoes.planilha_listas_id IS
  'Planilha "Nexa OS — Listas" no Google Drive da empresa (atualizada todo dia às 9h).';

-- Quem está nas listas da empresa (todas as famílias pedidas, sem repetir pessoa). Só o servidor.
CREATE OR REPLACE FUNCTION public.mkt_publico_servico(_emp uuid, _filtros jsonb)
RETURNS TABLE (
  contato_id uuid, nome text, telefone text, familias text[],
  cliente_em timestamptz, servico_tipo text, orcamento_em timestamptz, orcamento_valor numeric,
  orcamento_a_vista numeric, orcamento_km numeric, conversa_em timestamptz,
  perdido_preco_em timestamptz, agendado_para date,
  dias_cliente int, dias_orcamento int, dias_conversa int,
  endereco text, cep text, latitude double precision, longitude double precision,
  pode_receber boolean, motivo text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM private.mkt_publico(_emp, _filtros, false, NULL) LIMIT 20000
$$;
REVOKE ALL ON FUNCTION public.mkt_publico_servico(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_publico_servico(uuid, jsonb) TO service_role;
