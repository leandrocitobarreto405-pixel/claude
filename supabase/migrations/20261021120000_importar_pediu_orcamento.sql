-- Importação da base: coluna "Pediu orçamento". Quando for Sim (sim, s, true, 1, x, yes) e a
-- linha tiver data de entrada, o contato ganha orcamento_em = data de entrada (sem sobrescrever uma
-- data de orçamento mais recente) e passa a contar em "Orçamento sem agendamento". Não ou vazio:
-- como antes (entra em "Conversou e não pediu orçamento" pela data de entrada).
CREATE OR REPLACE FUNCTION public.mkt_importar_contatos(_emp uuid, _linhas jsonb, _origem text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r jsonb;
  fone text;
  v_tipo text;
  existia boolean;
  entrada timestamptz;
  lidas int := 0;
  novos int := 0;
  atualizados int := 0;
  invalidas int := 0;
  com_orcamento int := 0;
  exemplos_invalidos jsonb := '[]';
BEGIN
  IF jsonb_typeof(_linhas) <> 'array' THEN
    RAISE EXCEPTION 'linhas inválidas';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(_linhas) LOOP
    lidas := lidas + 1;
    fone := private.normalizar_telefone(r->>'telefone');
    v_tipo := CASE WHEN r->>'tipo' = 'comprador' THEN 'comprador' ELSE 'nao_comprador' END;
    IF fone IS NULL OR fone !~ '^55[1-9][0-9][0-9]{8,9}$' THEN
      invalidas := invalidas + 1;
      IF jsonb_array_length(exemplos_invalidos) < 10 THEN
        exemplos_invalidos := exemplos_invalidos || to_jsonb(left(coalesce(r->>'telefone', ''), 40));
      END IF;
      CONTINUE;
    END IF;
    existia := EXISTS (SELECT 1 FROM public.mkt_contatos WHERE empresa_id = _emp
                        AND private.telefone_chave(normalized_phone) = private.telefone_chave(fone));
    entrada := (nullif(r->>'entrada_em', '')::date + time '12:00') AT TIME ZONE 'America/Sao_Paulo';
    PERFORM private.mkt_upsert_contato(_emp, fone, left(r->>'nome', 120), v_tipo,
      (nullif(r->>'servico_em', '')::date + time '12:00') AT TIME ZONE 'America/Sao_Paulo',
      CASE WHEN v_tipo = 'comprador' THEN coalesce(r->>'servico_tipo', 'desconhecido') END,
      entrada, left(r->>'interesse', 120), left(_origem, 120));
    -- Pediu orçamento: a data de entrada vira a data do orçamento (a mais recente fica).
    IF lower(btrim(coalesce(r->>'pediu_orcamento', ''))) IN ('true', 'sim', 's', '1', 'x', 'yes')
       AND entrada IS NOT NULL THEN
      UPDATE public.mkt_contatos SET orcamento_em = entrada
       WHERE empresa_id = _emp
         AND private.telefone_chave(normalized_phone) = private.telefone_chave(fone)
         AND (orcamento_em IS NULL OR orcamento_em < entrada);
      com_orcamento := com_orcamento + 1;
    END IF;
    IF existia THEN atualizados := atualizados + 1; ELSE novos := novos + 1; END IF;
  END LOOP;
  PERFORM public.mkt_sincronizar_base(_emp);
  PERFORM private.mkt_log(_emp, 'importacao', 'concluida', jsonb_build_object(
    'origem', _origem, 'lidas', lidas, 'novos', novos, 'atualizados', atualizados, 'invalidas', invalidas,
    'com_orcamento', com_orcamento));
  RETURN jsonb_build_object('lidas', lidas, 'novos', novos, 'atualizados', atualizados,
    'invalidas', invalidas, 'exemplos_invalidos', exemplos_invalidos, 'com_orcamento', com_orcamento,
    'compradores', (SELECT count(*) FROM public.mkt_contatos WHERE empresa_id = _emp AND tipo = 'comprador'),
    'nao_compradores', (SELECT count(*) FROM public.mkt_contatos WHERE empresa_id = _emp AND tipo = 'nao_comprador'));
END $function$;
