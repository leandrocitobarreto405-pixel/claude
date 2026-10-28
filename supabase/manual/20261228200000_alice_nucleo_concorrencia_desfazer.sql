-- Desfaz 20261228200000_alice_nucleo_concorrencia: volta o núcleo de antes (app_settings,
-- alice_roteiro_copia_20261027_concorrencia) na Turbine e no Modelo Nexa.
BEGIN;
UPDATE public.ia_configuracoes c
   SET instrucoes = s.value->>'instrucoes'
  FROM public.app_settings s
 WHERE s.empresa_id = c.empresa_id
   AND s.key = 'alice_roteiro_copia_20261027_concorrencia'
   AND c.empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');
COMMIT;
