-- NÃO RODAR: substituído por supabase/manual/20261031_alice_unico.sql (SQL único de 31/10).
-- Alice (31/10): foto do técnico só depois do agendamento (Parte B), texto explicativo, regra B2B
-- e o reforço do deslocamento (substitui supabase/manual/20261030_alice_deslocamento.sql, que não
-- foi rodado). Turbine e Modelo Nexa. Rodar no SQL Editor, inteiro, só com OK do usuário.
-- Confere o md5 antes, que cada trecho aparece uma vez e o md5 depois; guarda o texto de antes em
-- app_settings (alice_roteiro_copia_20261031). Em qualquer diferença, nada muda (ROLLBACK).
BEGIN;

DO $$
BEGIN
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> '1ccfb039745f97473c2227aebbe5fc9b'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> 'b16aacab078795a2a78566b89cbf44f7' THEN
    RAISE EXCEPTION 'O texto da Alice mudou desde a conferência (md5 antes). Nada foi alterado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ia_configuracoes WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999') AND (
     (length(instrucoes) - length(replace(instrucoes, $t$(5) Só depois de resposta positiva: (a) foto e nome do técnico com `enviar_dados_tecnico` (se não estiver disponível, pule; se mandou a explicação, comece com "Como eu te falei,"): "Como eu te falei, esse é o [nome do técnico], o técnico que eu designei pro seu serviço. Ele tem mais de {anos_experiencia} anos de experiência e vai cuidar do seu [estofado] com todo o carinho 💙"; (b) na mesma resposta, uma mensagem só sobre a agenda: "Nossa agenda costuma encher rápido, então já quero reservar um horário pra você. / Você prefere de manhã ou à tarde, durante a semana ou no sábado?" (sábado só se `consultar_agenda` mostrar sábado; nunca diga que temos um técnico só). **Colchão tem pergunta própria na hora de agendar: veja o módulo.**$t$, ''))) / length($t$(5) Só depois de resposta positiva: (a) foto e nome do técnico com `enviar_dados_tecnico` (se não estiver disponível, pule; se mandou a explicação, comece com "Como eu te falei,"): "Como eu te falei, esse é o [nome do técnico], o técnico que eu designei pro seu serviço. Ele tem mais de {anos_experiencia} anos de experiência e vai cuidar do seu [estofado] com todo o carinho 💙"; (b) na mesma resposta, uma mensagem só sobre a agenda: "Nossa agenda costuma encher rápido, então já quero reservar um horário pra você. / Você prefere de manhã ou à tarde, durante a semana ou no sábado?" (sábado só se `consultar_agenda` mostrar sábado; nunca diga que temos um técnico só). **Colchão tem pergunta própria na hora de agendar: veja o módulo.**$t$) <> 1
     OR (length(instrucoes) - length(replace(instrucoes, $t$assim que você aprovar o orçamento eu já te mando a foto do técnico responsável$t$, ''))) / length($t$assim que você aprovar o orçamento eu já te mando a foto do técnico responsável$t$) <> 1
     OR (length(instrucoes) - length(replace(instrucoes, $t$Qualquer outro, ou somar campanha com indicação, transfira.$t$, ''))) / length($t$Qualquer outro, ou somar campanha com indicação, transfira.$t$) <> 1
     OR (length(instrucoes) - length(replace(instrucoes, $t$- CEP: peça uma única vez. Se `consultar_cep` não localizar, aceite rua e bairro e siga. Só diga que está fora da área depois de confirmar; nesse caso informe com clareza, sem prometer que a especialista "vai ver", transfira e diga em quanto tempo o cliente terá resposta.$t$, ''))) / length($t$- CEP: peça uma única vez. Se `consultar_cep` não localizar, aceite rua e bairro e siga. Só diga que está fora da área depois de confirmar; nesse caso informe com clareza, sem prometer que a especialista "vai ver", transfira e diga em quanto tempo o cliente terá resposta.$t$) <> 1)) THEN
    RAISE EXCEPTION 'Algum trecho não aparece exatamente uma vez. Nada foi alterado.';
  END IF;
END $$;

INSERT INTO public.app_settings (empresa_id, key, value)
SELECT empresa_id, 'alice_roteiro_copia_20261031',
       jsonb_build_object('instrucoes', instrucoes, 'md5', md5(instrucoes), 'salvo_em', now())
  FROM public.ia_configuracoes
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999')
ON CONFLICT (empresa_id, key) DO UPDATE SET value = EXCLUDED.value;

UPDATE public.ia_configuracoes
   SET instrucoes = replace(replace(replace(replace(instrucoes, $t$(5) Só depois de resposta positiva: (a) foto e nome do técnico com `enviar_dados_tecnico` (se não estiver disponível, pule; se mandou a explicação, comece com "Como eu te falei,"): "Como eu te falei, esse é o [nome do técnico], o técnico que eu designei pro seu serviço. Ele tem mais de {anos_experiencia} anos de experiência e vai cuidar do seu [estofado] com todo o carinho 💙"; (b) na mesma resposta, uma mensagem só sobre a agenda: "Nossa agenda costuma encher rápido, então já quero reservar um horário pra você. / Você prefere de manhã ou à tarde, durante a semana ou no sábado?" (sábado só se `consultar_agenda` mostrar sábado; nunca diga que temos um técnico só). **Colchão tem pergunta própria na hora de agendar: veja o módulo.**$t$, $t$(5) Só depois de resposta positiva: uma mensagem só sobre a agenda: "Nossa agenda costuma encher rápido, então já quero reservar um horário pra você. / Você prefere de manhã ou à tarde, durante a semana ou no sábado?" (sábado só se `consultar_agenda` mostrar sábado; nunca diga que temos um técnico só). **Colchão tem pergunta própria na hora de agendar: veja o módulo.**$t$ || chr(10) || $t$(6) Só depois que o cliente CONFIRMAR dia e horário (agendamento fechado): foto e nome do técnico com `enviar_dados_tecnico` (se não estiver disponível, pule): "Prontinho, [nome], seu horário está reservado! Esse é o [nome do técnico], que vai cuidar do seu [estofado]. Ele tem mais de {anos_experiencia} anos de experiência e vai fazer tudo com muito carinho 💙". Nunca mande a foto do técnico antes disso, nem para quem ainda está comparando, pensando ou só escolheu a opção do orçamento.$t$), $t$assim que você aprovar o orçamento eu já te mando a foto do técnico responsável$t$, $t$assim que a gente agendar eu já te mando a foto do técnico responsável$t$), $t$Qualquer outro, ou somar campanha com indicação, transfira.$t$, $t$Qualquer outro, ou somar campanha com indicação, transfira.$t$ || chr(10) || $t$- **Cliente empresa ou condomínio:** não ofereça desconto com prazo ("vale até amanhã"); ofereça proposta formal em PDF com CNPJ e prazo de pagamento.$t$), $t$- CEP: peça uma única vez. Se `consultar_cep` não localizar, aceite rua e bairro e siga. Só diga que está fora da área depois de confirmar; nesse caso informe com clareza, sem prometer que a especialista "vai ver", transfira e diga em quanto tempo o cliente terá resposta.$t$, $t$- CEP: peça uma única vez. Se `consultar_cep` não localizar, aceite rua e bairro e siga. Só diga que está fora da área depois de confirmar; nesse caso informe com clareza, sem prometer que a especialista "vai ver", transfira e diga em quanto tempo o cliente terá resposta.$t$ || chr(10) || $t$- Se o cliente perguntar sobre deslocamento ou taxa de visita: diga que o valor enviado já é o final para o endereço dele, sem citar taxa nem acréscimo.$t$)
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');

DO $$
BEGIN
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> '40854f6cf1617f9fdef34c415ef66670'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> 'c06d28d59121870af95c11e0d260c5be' THEN
    RAISE EXCEPTION 'O resultado não bateu com a simulação (md5 depois). Nada foi alterado.';
  END IF;
  IF (SELECT count(*) FROM public.app_settings WHERE key = 'alice_roteiro_copia_20261031'
        AND empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999')) <> 2 THEN
    RAISE EXCEPTION 'As cópias de antes não foram guardadas. Nada foi alterado.';
  END IF;
END $$;

COMMIT;

-- Conferência (deve mostrar 40854f6c… na Turbine e c06d28d5… no Modelo):
-- SELECT empresa_id, md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');

-- Como desfazer (volta o texto de antes pela cópia), só com OK:
-- UPDATE public.ia_configuracoes i SET instrucoes = a.value->>'instrucoes'
--   FROM public.app_settings a
--  WHERE a.key = 'alice_roteiro_copia_20261031' AND a.empresa_id = i.empresa_id
--    AND i.empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');
