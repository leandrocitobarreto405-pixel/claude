-- Desfaz 20261226120000_alice_nucleo_audio: volta o núcleo de antes (guardado em app_settings,
-- alice_roteiro_copia_20261027_audio) na Turbine e no Modelo Nexa e desliga as explicações em áudio
-- da Turbine (a resposta em áudio a quem mandou áudio continua como estava).
BEGIN;
UPDATE public.ia_configuracoes c
   SET instrucoes = s.value->>'instrucoes'
  FROM public.app_settings s
 WHERE s.empresa_id = c.empresa_id
   AND s.key = 'alice_roteiro_copia_20261027_audio'
   AND c.empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');
UPDATE public.ia_configuracoes SET audio_explicacoes = false
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
COMMIT;
