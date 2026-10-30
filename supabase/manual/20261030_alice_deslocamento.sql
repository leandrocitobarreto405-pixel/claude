-- Alice (30/10): reforço no núcleo sobre o acréscimo por distância (o valor já vem dentro do preço
-- de cada item). Turbine e Modelo Nexa. Rodar no SQL Editor, inteiro, só com OK do usuário.
-- Confere o md5 antes e depois e que o trecho-âncora aparece uma vez; guarda o texto de antes em
-- app_settings (alice_roteiro_copia_20261030). Em qualquer diferença, nada muda (ROLLBACK).
BEGIN;

DO $$
BEGIN
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> '1ccfb039745f97473c2227aebbe5fc9b'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> 'b16aacab078795a2a78566b89cbf44f7' THEN
    RAISE EXCEPTION 'O texto da Alice mudou desde a conferência (md5 antes). Nada foi alterado.';
  END IF;
END $$;

INSERT INTO public.app_settings (empresa_id, key, value)
SELECT empresa_id, 'alice_roteiro_copia_20261030',
       jsonb_build_object('instrucoes', instrucoes, 'md5', md5(instrucoes), 'salvo_em', now())
  FROM public.ia_configuracoes
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999')
ON CONFLICT (empresa_id, key) DO UPDATE SET value = EXCLUDED.value;

UPDATE public.ia_configuracoes
   SET instrucoes = replace(
         instrucoes,
         $t$- CEP: peça uma única vez. Se `consultar_cep` não localizar, aceite rua e bairro e siga. Só diga que está fora da área depois de confirmar; nesse caso informe com clareza, sem prometer que a especialista "vai ver", transfira e diga em quanto tempo o cliente terá resposta.$t$,
         $t$- CEP: peça uma única vez. Se `consultar_cep` não localizar, aceite rua e bairro e siga. Só diga que está fora da área depois de confirmar; nesse caso informe com clareza, sem prometer que a especialista "vai ver", transfira e diga em quanto tempo o cliente terá resposta.$t$
           || chr(10)
           || $t$- Se o cliente perguntar sobre deslocamento ou taxa de visita: diga que o valor enviado já é o final para o endereço dele, sem citar taxa nem acréscimo.$t$)
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');

DO $$
BEGIN
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> '8d442f91f48d2ee9d2cb70d0ce4366a3'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> '382010e207942e5512f916a36bcd36f4' THEN
    RAISE EXCEPTION 'O resultado não bateu com a simulação (md5 depois). Nada foi alterado.';
  END IF;
  IF (SELECT count(*) FROM public.app_settings WHERE key = 'alice_roteiro_copia_20261030'
        AND empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999')) <> 2 THEN
    RAISE EXCEPTION 'As cópias de antes não foram guardadas. Nada foi alterado.';
  END IF;
END $$;

COMMIT;

-- Conferência (deve mostrar 8d442f91… na Turbine e 382010e2… no Modelo):
-- SELECT empresa_id, md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');

-- Como desfazer (volta o texto de antes pela cópia), só com OK:
-- UPDATE public.ia_configuracoes i
--    SET instrucoes = a.value->>'instrucoes'
--   FROM public.app_settings a
--  WHERE a.key = 'alice_roteiro_copia_20261030' AND a.empresa_id = i.empresa_id
--    AND i.empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');
