-- Desfaz o provedor ElevenLabs (antes: voltar todas as empresas ao Google).
UPDATE public.ia_configuracoes SET audio_provedor = 'google' WHERE audio_provedor <> 'google';
-- As colunas novas (ia_configuracoes.audio_provedor/audio_eleven_voz/audio_eleven_modelo e
-- ia_audios_uso.provedor/modelo/aviso) podem ficar: o código antigo não as usa. Se precisar tirar:
-- ALTER TABLE public.ia_configuracoes DROP COLUMN audio_provedor, DROP COLUMN audio_eleven_voz, DROP COLUMN audio_eleven_modelo;
-- ALTER TABLE public.ia_audios_uso DROP COLUMN provedor, DROP COLUMN modelo, DROP COLUMN aviso;
DELETE FROM public.configuracoes_plataforma WHERE chave = 'elevenlabs_usd_por_mil_creditos';
