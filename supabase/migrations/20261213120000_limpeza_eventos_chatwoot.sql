-- Limpeza dos eventos brutos do Chatwoot (aprovada em 26/10/2026; liga só depois do primeiro
-- backup): o banco grátis tem 500 MB e os eventos crescem ~100 MB por mês.
-- 1. Apaga eventos já processados ou ignorados com mais de 7 dias que nenhuma mensagem usa
--    (conversa atualizada, contato, mudança de situação...).
-- 2. Enxuga eventos de mensagem com mais de 30 dias: a linha continua, só com os anexos e o
--    remetente (tipo, nome, e-mail), que são o que a tela e a Alice leem depois.
-- 3. Nunca mexe em evento recebido, com erro ou de caixa não mapeada.
-- Lote limitado por chamada (a tarefa do Chatwoot chama a cada 5 minutos). Nasce DESLIGADA:
-- configuracoes_plataforma.limpeza_eventos_ativa = false.

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_raw_event_reference
  ON public.whatsapp_messages (raw_event_reference) WHERE raw_event_reference IS NOT NULL;

INSERT INTO public.configuracoes_plataforma (chave, valor, descricao)
VALUES ('limpeza_eventos_ativa', 'false', 'Limpeza diária dos eventos brutos do Chatwoot (apaga 7 dias / enxuga 30 dias)')
ON CONFLICT (chave) DO NOTHING;

CREATE OR REPLACE FUNCTION private.limpar_eventos_chatwoot(_limite int DEFAULT 2000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  apagados int := 0;
  enxugados int := 0;
BEGIN
  IF NOT coalesce((SELECT valor = 'true'::jsonb FROM public.configuracoes_plataforma
                    WHERE chave = 'limpeza_eventos_ativa'), false) THEN
    RETURN jsonb_build_object('ligada', false);
  END IF;

  WITH alvo AS (
    SELECT e.id FROM public.integracao_eventos e
     WHERE e.status IN ('processado', 'ignorado')
       AND e.recebido_em < now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.raw_event_reference = e.id::text)
     ORDER BY e.recebido_em
     LIMIT _limite
  )
  DELETE FROM public.integracao_eventos e USING alvo WHERE e.id = alvo.id;
  GET DIAGNOSTICS apagados = ROW_COUNT;

  WITH alvo AS (
    SELECT e.id FROM public.integracao_eventos e
     WHERE e.status IN ('processado', 'ignorado')
       AND e.recebido_em < now() - interval '30 days'
       AND (e.resultado IS NOT NULL OR (e.payload - 'attachments' - 'sender') <> '{}'::jsonb
            OR jsonb_typeof(e.payload->'sender') = 'object'
               AND ((e.payload->'sender') - 'type' - 'name' - 'email') <> '{}'::jsonb)
     ORDER BY e.recebido_em
     LIMIT _limite
  )
  UPDATE public.integracao_eventos e
     SET payload = jsonb_strip_nulls(jsonb_build_object(
           'attachments', e.payload->'attachments',
           'sender', CASE WHEN jsonb_typeof(e.payload->'sender') = 'object' THEN jsonb_strip_nulls(jsonb_build_object(
                       'type', e.payload->'sender'->'type',
                       'name', e.payload->'sender'->'name',
                       'email', e.payload->'sender'->'email')) END)),
         resultado = NULL
    FROM alvo WHERE e.id = alvo.id;
  GET DIAGNOSTICS enxugados = ROW_COUNT;

  RETURN jsonb_build_object('ligada', true, 'apagados', apagados, 'enxugados', enxugados);
END $$;
REVOKE ALL ON FUNCTION private.limpar_eventos_chatwoot(int) FROM PUBLIC, anon, authenticated;

-- Só o servidor (tarefa do Chatwoot) chama.
CREATE OR REPLACE FUNCTION public.limpar_eventos_chatwoot(_limite int DEFAULT 2000)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.limpar_eventos_chatwoot(_limite);
$$;
REVOKE ALL ON FUNCTION public.limpar_eventos_chatwoot(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.limpar_eventos_chatwoot(int) TO service_role;
GRANT EXECUTE ON FUNCTION private.limpar_eventos_chatwoot(int) TO service_role;
