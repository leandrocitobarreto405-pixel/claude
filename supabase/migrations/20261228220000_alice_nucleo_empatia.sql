-- Alice: empatia antes do interesse (28/10, item 6): em retomada, follow-up e trilha C, o primeiro
-- contato é sobre o que o cliente contou (obra, viagem, mudança, saúde, filho); o serviço vem depois
-- da resposta. Turbine e Modelo Nexa. Guarda o núcleo de antes em app_settings
-- (alice_roteiro_copia_20261028_empatia), acrescenta uma linha (quebra com chr(10)) e confere o md5
-- antes e depois (se algo não bater, nada é gravado).
DO $antes$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') THEN
    RETURN;
  END IF;
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> 'a5138f93420dbe53fa3064c4e53646e3'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> '90701374d8328f80cdba93fbc7a20995' THEN
    RAISE EXCEPTION 'O núcleo mudou desde a proposta: nada é gravado.';
  END IF;
END $antes$;

INSERT INTO public.app_settings (empresa_id, key, value)
SELECT empresa_id, 'alice_roteiro_copia_20261028_empatia',
       jsonb_build_object('instrucoes', instrucoes, 'md5', md5(instrucoes), 'salvo_em', now())
  FROM public.ia_configuracoes
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999')
ON CONFLICT DO NOTHING;

UPDATE public.ia_configuracoes
   SET instrucoes = replace(instrucoes, $t$Cada toque traz algo novo; nunca "está aí?" nem só o nome com interrogação; cliente disse não → pare, agradeça e `registrar_motivo_perda`.$t$, $t$Cada toque traz algo novo; nunca "está aí?" nem só o nome com interrogação; cliente disse não → pare, agradeça e `registrar_motivo_perda`.$t$ || chr(10) || $t$**Empatia antes do interesse (retomada, follow-up e trilha C):** se o cliente contou algo da vida dele (obra, viagem, mudança, saúde, filho, trabalho), o primeiro contato é sobre isso, com o nome e com carinho, sem falar do serviço. Ex.: "Oi, [nome]! Deu tudo certo com a obra aí no imóvel? Ficou do jeito que você queria? 😊". Só depois que ele responder, fale do serviço: "Que bom! Quando quiser, a gente já agenda a higienização pra deixar tudo novinho." Nunca abra com "passando para saber se podemos retomar seu atendimento".$t$)
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');

DO $depois$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') THEN
    RETURN;
  END IF;
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> '831c47cfc848e0ef4f2e3e4d1153e3ea'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> 'b3f28b91cd22a8e423f88f05ab5be389' THEN
    RAISE EXCEPTION 'Núcleo novo não confere.';
  END IF;
  IF (SELECT count(*) FROM public.app_settings WHERE key = 'alice_roteiro_copia_20261028_empatia') <> 2 THEN
    RAISE EXCEPTION 'Cópia do núcleo de antes não ficou guardada.';
  END IF;
END $depois$;
