-- Fase B, item 7: consumo de cada empresa no mês (Painel Nexa › Consumo). Só leitura, só a Nexa.
-- - IA (Alice): respostas sem erro, mensagens que ela enviou, custo em dólar.
-- - Áudio da Alice: áudios enviados e custo em reais (o custo inclui os de teste).
-- - Mensagens automáticas (não usam IA e não entram no custo de IA): campanhas e lembretes do
--   marketing, pós-atendimento da Alice (confirmação, pós-venda, avaliação) e agenda dos técnicos
--   (texto = 1 mensagem; modelo = 1, e mais 1 quando o texto da agenda também saiu).
-- O mês vale pelo horário de São Paulo. Nenhuma tabela nova, nenhum dado muda.
CREATE OR REPLACE FUNCTION public.consumo_empresas(_mes date)
RETURNS TABLE (
  empresa_id uuid,
  nome text,
  eh_teste boolean,
  ia_respostas bigint,
  ia_mensagens bigint,
  ia_custo_usd numeric,
  audios bigint,
  audio_custo_reais numeric,
  mkt_mensagens bigint,
  pos_atendimento_mensagens bigint,
  agenda_mensagens bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ini timestamptz := (date_trunc('month', _mes)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  fim timestamptz := ((date_trunc('month', _mes) + interval '1 month')::timestamp AT TIME ZONE 'America/Sao_Paulo');
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'Só a equipe da Nexa vê o consumo das empresas.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.id, e.nome, e.eh_teste,
    coalesce(ia.respostas, 0), coalesce(ia.mensagens, 0), coalesce(ia.custo, 0),
    coalesce(au.qtd, 0), coalesce(au.custo, 0),
    coalesce(mk.qtd, 0), coalesce(pa.qtd, 0), coalesce(ag.qtd, 0)
  FROM public.empresas e
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE x.erro IS NULL) AS respostas,
           coalesce(sum(coalesce(array_length(x.mensagens_enviadas, 1), 0)), 0)::bigint AS mensagens,
           round(coalesce(sum(x.custo_usd), 0), 4) AS custo
      FROM public.ia_execucoes x
     WHERE x.empresa_id = e.id AND x.created_at >= ini AND x.created_at < fim
  ) ia ON true
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE x.situacao = 'enviado') AS qtd, round(coalesce(sum(x.custo_reais), 0), 2) AS custo
      FROM public.ia_audios_uso x
     WHERE x.empresa_id = e.id AND x.created_at >= ini AND x.created_at < fim
  ) au ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS qtd FROM public.mkt_envios x
     WHERE x.empresa_id = e.id AND x.enviado_em >= ini AND x.enviado_em < fim
  ) mk ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS qtd FROM public.ia_pos_atendimento x
     WHERE x.empresa_id = e.id AND x.situacao = 'enviado' AND x.enviado_em >= ini AND x.enviado_em < fim
  ) pa ON true
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(1 + CASE WHEN x.via = 'modelo' AND x.texto_enviado_em IS NOT NULL THEN 1 ELSE 0 END), 0)::bigint AS qtd
      FROM public.agenda_tecnicos_envios x
     WHERE x.empresa_id = e.id AND x.enviado_em >= ini AND x.enviado_em < fim
  ) ag ON true
  WHERE e.ativo
  ORDER BY e.eh_teste, e.nome;
END $$;
REVOKE ALL ON FUNCTION public.consumo_empresas(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consumo_empresas(date) TO authenticated, service_role;
