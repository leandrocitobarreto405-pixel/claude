-- Alice em áudio com a ElevenLabs e saldo das contas (27/10/2026).
-- 1. ia_configuracoes: audio_explicacoes (a Alice pode mandar explicações em áudio com falar_em_audio;
--    começa desligado) e audio_limite_diario_creditos (teto diário em créditos da ElevenLabs por
--    empresa; aviso no sininho em 80%, texto ao bater o teto).
-- 2. ia_audios_uso.creditos: créditos da ElevenLabs de cada áudio (0 quando saiu pelo Google).
-- 3. Saldo estimado da conta da IA (Painel Nexa): a Nexa anota "crédito carregado: US$ X em DD/MM"
--    (configuracoes_plataforma ia_credito_carregado_usd / ia_credito_carregado_em); o banco desconta o
--    custo medido das respostas da Alice desde a data e avisa a Nexa em 30% e 10% (uma vez por carga).
-- Só colunas e funções novas.

ALTER TABLE public.ia_configuracoes
  ADD COLUMN IF NOT EXISTS audio_explicacoes boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS audio_limite_diario_creditos integer
    CHECK (audio_limite_diario_creditos IS NULL OR audio_limite_diario_creditos > 0);
ALTER TABLE public.ia_audios_uso ADD COLUMN IF NOT EXISTS creditos numeric(12,2);

-- Saldo estimado da conta da IA (null = a Nexa ainda não anotou a carga).
CREATE OR REPLACE FUNCTION public.ia_saldo_estimado()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  usd numeric;
  em date;
  gasto numeric;
BEGIN
  IF NOT (private.is_nexa_admin() OR coalesce(auth.jwt()->>'role', '') = 'service_role'
          OR coalesce(current_setting('request.jwt.claims', true), '') = '') THEN
    RAISE EXCEPTION 'Só a Nexa.' USING ERRCODE = '42501';
  END IF;
  SELECT (valor #>> '{}')::numeric INTO usd FROM public.configuracoes_plataforma WHERE chave = 'ia_credito_carregado_usd';
  SELECT (valor #>> '{}')::date INTO em FROM public.configuracoes_plataforma WHERE chave = 'ia_credito_carregado_em';
  IF usd IS NULL OR usd <= 0 OR em IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(sum(custo_usd), 0) INTO gasto FROM public.ia_execucoes
   WHERE created_at >= (em::timestamp AT TIME ZONE 'America/Sao_Paulo');
  RETURN jsonb_build_object(
    'carregado_usd', usd, 'carregado_em', em, 'consumido_usd', round(gasto, 2),
    'restante_usd', round(greatest(usd - gasto, 0), 2),
    'pct_restante', round(greatest(usd - gasto, 0) / usd * 100, 1));
END $$;
REVOKE ALL ON FUNCTION public.ia_saldo_estimado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_saldo_estimado() TO authenticated, service_role;

-- Rotina: devolve 30 ou 10 quando o saldo estimado cruzou o nível e a Nexa ainda não foi avisada
-- nesta carga (marca em configuracoes_plataforma ia_saldo_avisos).
CREATE OR REPLACE FUNCTION public.ia_saldo_hora_de_avisar()
RETURNS TABLE (nivel integer, restante_usd numeric, pct_restante numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  s jsonb := public.ia_saldo_estimado();
  carga text;
  marcas jsonb;
  n integer;
BEGIN
  IF s IS NULL THEN RETURN; END IF;
  carga := (s->>'carregado_usd') || '@' || (s->>'carregado_em');
  SELECT valor INTO marcas FROM public.configuracoes_plataforma WHERE chave = 'ia_saldo_avisos';
  IF marcas IS NULL OR marcas->>'carga' IS DISTINCT FROM carga THEN
    marcas := jsonb_build_object('carga', carga);
  END IF;
  n := CASE WHEN (s->>'pct_restante')::numeric <= 10 AND NOT marcas ? '10' THEN 10
            WHEN (s->>'pct_restante')::numeric <= 30 AND NOT marcas ? '30' AND NOT marcas ? '10' THEN 30 END;
  IF n IS NULL THEN RETURN; END IF;
  marcas := marcas || jsonb_build_object(n::text, now());
  INSERT INTO public.configuracoes_plataforma (chave, valor, descricao, updated_at)
  VALUES ('ia_saldo_avisos', marcas, 'Avisos de saldo baixo da conta da IA já mandados (por carga)', now())
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now();
  RETURN QUERY SELECT n, (s->>'restante_usd')::numeric, (s->>'pct_restante')::numeric;
END $$;
REVOKE ALL ON FUNCTION public.ia_saldo_hora_de_avisar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_saldo_hora_de_avisar() TO service_role;
