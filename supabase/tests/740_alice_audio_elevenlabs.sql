-- Áudio com a ElevenLabs (migração 20261218120000): padrão Google, voz e modelo validados, uso com
-- provedor. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.deve_falhar(_sql text, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU (deveria ter sido bloqueado): %', _msg;
END $$;

INSERT INTO public.ia_configuracoes (empresa_id, ativo, nome, instrucoes, perguntas_frequentes)
VALUES ('99999999-9999-4999-8999-999999999999', false, 'Alice', 'r', '')
ON CONFLICT (empresa_id) DO NOTHING;
SELECT pg_temp.ok((SELECT audio_provedor = 'google' AND audio_eleven_voz IS NULL AND audio_eleven_modelo = 'eleven_flash_v2_5'
                     FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999'),
  'padrão: Google, sem voz da ElevenLabs, Flash');
UPDATE public.ia_configuracoes SET audio_eleven_voz = 'BQzELs93jJsUOf5rCb9p', audio_eleven_modelo = 'eleven_v4'
 WHERE empresa_id = '99999999-9999-4999-8999-999999999999';
SELECT pg_temp.deve_falhar($$UPDATE public.ia_configuracoes SET audio_provedor = 'outro'
  WHERE empresa_id = '99999999-9999-4999-8999-999999999999'$$, 'provedor desconhecido');
SELECT pg_temp.deve_falhar($$UPDATE public.ia_configuracoes SET audio_eleven_voz = 'voz com espaço'
  WHERE empresa_id = '99999999-9999-4999-8999-999999999999'$$, 'voice_id inválido');
SELECT pg_temp.deve_falhar($$UPDATE public.ia_configuracoes SET audio_eleven_modelo = 'eleven_v3'
  WHERE empresa_id = '99999999-9999-4999-8999-999999999999'$$, 'modelo fora da lista');
INSERT INTO public.ia_audios_uso (empresa_id, voz, situacao, caracteres, custo_reais, texto_falado, provedor, modelo, aviso)
VALUES ('99999999-9999-4999-8999-999999999999', 'pt-BR-Chirp3-HD-Kore', 'enviado', 80, 0.01, 'Oi', 'google', NULL,
        'ElevenLabs recusou (429); foi pelo Google');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.ia_audios_uso WHERE aviso LIKE 'ElevenLabs recusou%'), 'uso com aviso');
SELECT pg_temp.ok((SELECT (valor #>> '{}')::numeric = 0.22 FROM public.configuracoes_plataforma
                    WHERE chave = 'elevenlabs_usd_por_mil_creditos'), 'preço por mil créditos');
ROLLBACK;
