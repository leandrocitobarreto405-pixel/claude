-- Desfaz 20261225120000_alice_audio_eleven_saldo e a troca da Turbine para a ElevenLabs.
-- Antes, desfaça o código: git revert <commit do áudio com a ElevenLabs> (sem force push).
BEGIN;
-- Turbine volta ao Google (como estava em 27/10 antes da troca), sem explicações em áudio.
UPDATE public.ia_configuracoes
   SET audio_provedor = 'google', audio_explicacoes = false, audio_limite_diario_creditos = NULL
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
DROP FUNCTION IF EXISTS public.ia_saldo_hora_de_avisar();
DROP FUNCTION IF EXISTS public.ia_saldo_estimado();
DELETE FROM public.configuracoes_plataforma
 WHERE chave IN ('ia_credito_carregado_usd', 'ia_credito_carregado_em', 'ia_saldo_avisos', 'eleven_saldo_avisos');
-- As colunas novas ficam (sem uso, não atrapalham). Para tirar também:
-- ALTER TABLE public.ia_configuracoes DROP COLUMN audio_explicacoes, DROP COLUMN audio_limite_diario_creditos;
-- ALTER TABLE public.ia_audios_uso DROP COLUMN creditos;
COMMIT;
