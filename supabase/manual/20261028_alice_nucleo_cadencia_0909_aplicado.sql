-- GRAVADO MANUALMENTE PELO SQL EDITOR em 28/10/2026 às 13h37 (não rodar de novo). Conferido:
-- md5 Turbine 964978af…, Modelo 28f8bf52…, módulos f238e0ac… nos dois; 2 cópias em alice_roteiro_copia_20261028_0909.
-- Alice, conversa 0909 (28/10): núcleo (itens 2, 3 e 4) e módulo Impermeabilização.
-- Turbine e Modelo Nexa. Quebras de linha com chr(10). Confere o md5 antes e depois: se algo não
-- bater, nada é gravado (a transação inteira volta). Guarda o texto de antes em app_settings
-- (alice_roteiro_copia_20261028_0909).
BEGIN;
DO $antes$
BEGIN
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> '831c47cfc848e0ef4f2e3e4d1153e3ea'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> 'b3f28b91cd22a8e423f88f05ab5be389'
     OR (SELECT md5(modulos::text) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> '65726740fdfbf8b1ecfd77fc133e5171'
     OR (SELECT md5(modulos::text) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> '65726740fdfbf8b1ecfd77fc133e5171' THEN
    RAISE EXCEPTION 'O núcleo mudou desde a proposta: nada é gravado.';
  END IF;
END $antes$;

INSERT INTO public.app_settings (empresa_id, key, value)
SELECT empresa_id, 'alice_roteiro_copia_20261028_0909',
       jsonb_build_object('instrucoes', instrucoes, 'modulos', modulos, 'md5', md5(instrucoes), 'salvo_em', now())
  FROM public.ia_configuracoes
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999')
ON CONFLICT DO NOTHING;

UPDATE public.ia_configuracoes
   SET instrucoes = replace(replace(replace(replace(replace(replace(instrucoes, $t$Depois de ter foto e CEP, pergunte o motivo (a pergunta certa de cada serviço está no módulo). Como reagir (guia, adapte ao que o cliente disse):$t$, $t$Primeira resposta: peça só a foto e o CEP, nunca três pedidos de uma vez. A pergunta do motivo vem depois, quando você comentar a foto que o cliente mandou (a pergunta certa de cada serviço está no módulo). Como reagir (guia, adapte ao que o cliente disse):$t$), $t$Qualquer mensagem do cliente cancela os toques e a sequência recomeça da sua última resposta.$t$, $t$A sequência começa uma vez (no envio do orçamento) e nunca volta para o começo: a mensagem do cliente só cancela o toque pendente e, quando a conversa parar de novo, o sistema segue a etapa seguinte. Se o cliente conversou no dia, o próximo toque só sai no dia seguinte; depois de um retorno combinado sem resposta, só 2 dias depois. Novo orçamento (outro serviço ou valor) recomeça a sequência.$t$), $t$Cada toque traz algo novo; nunca "está aí?" nem só o nome com interrogação; cliente disse não → pare, agradeça e `registrar_motivo_perda`.$t$, $t$Cada toque traz algo novo; nunca "está aí?" nem só o nome com interrogação; cliente disse não → pare, agradeça e `registrar_motivo_perda`.$t$ || chr(10) || $t$**Não repita a pergunta:** se você perguntou algo e o cliente não respondeu, o toque seguinte não repete a pergunta nem cobra de outro jeito ("conseguiu ver com seu esposo?" e depois "ficou com alguma dúvida?" é cobrar de novo). Traga algo novo e útil (um cuidado com o estofado, uma foto de resultado, a oferta de reservar o horário, a disponibilidade da agenda) ou espere. Se o cliente já disse o que vai fazer ("vou ver com meu esposo", "vou pensar", "te aviso"), nunca mande "Ficou com alguma dúvida sobre o orçamento?".$t$ || chr(10) || $t$**Vai decidir com alguém** (esposo, esposa, sócio): combine o dia e agende a trilha C; no dia, um toque só: "E aí, [nome], conseguiu conversar com o [esposo]? O que ele achou?". Sem resposta, o próximo só sai 2 dias depois, com algo novo.$t$), $t$40 min: "Oi, [nome]! Ficou com alguma dúvida sobre o orçamento?"$t$, $t$40 min: algo novo sobre o serviço, ligado ao que o cliente contou (um cuidado, um benefício ou como funciona no dia), sem perguntar de novo se viu o orçamento$t$), $t$Dia seguinte 10h: "Bom dia, [nome]! Ainda quer cuidar do seu estofado? Com a foto e o CEP eu te passo o orçamento hoje, combinado?"$t$, $t$Dia seguinte 10h: algo novo (um benefício da higienização ligado ao que o cliente contou, ou a agenda da semana) e que, com a foto e o CEP, você passa o orçamento hoje$t$), $t$agende para a data e retome citando o evento ("Oi, [nome]! Deu tudo certo na mudança?").$t$, $t$agende para a data e retome citando o evento ("Oi, [nome]! Deu tudo certo na mudança?").$t$ || chr(10) || $t$**Serviço para data futura** (o cliente só pode ou precisa fazer daqui a mais de 2 semanas: "a poltrona chega só em dezembro", "vou mudar mês que vem"): nada de urgência de validade ("vale até quinta") nem toques diários. Ofereça garantir o valor e reservar: "Posso deixar esse valor garantido pra você até a poltrona chegar e já reservo um horário pra [primeira semana de dezembro]?" (com `garantir_valor_ate`, o orçamento passa a valer até a data). Se ele não quiser reservar agora: agende UM retorno (trilha C) uns 7 dias antes da data que ele falou e nenhum outro toque; no retorno, empatia primeiro (regra acima) e depois a oferta de reservar com o valor garantido.$t$),
       modulos = (SELECT jsonb_agg(CASE WHEN strpos(m->>'texto', $t$**Diagnóstico:** "Obrigada pelas informações! Quero entender direitinho pra te ajudar da melhor forma 💙 / Me conta, [nome], o que te motivou a buscar a impermeabilização agora?$t$) > 0 THEN jsonb_set(m, '{texto}', to_jsonb(replace(m->>'texto', $t$**Diagnóstico:** "Obrigada pelas informações! Quero entender direitinho pra te ajudar da melhor forma 💙 / Me conta, [nome], o que te motivou a buscar a impermeabilização agora?$t$, $t$**Diagnóstico:** foto e CEP primeiro, nunca junto com esta pergunta; ela vem depois, quando você comentar a foto: "Obrigada pelas informações! Quero entender direitinho pra te ajudar da melhor forma 💙 / Me conta, [nome], o que te motivou a buscar a impermeabilização agora?$t$))) ELSE m END ORDER BY o) FROM jsonb_array_elements(modulos) WITH ORDINALITY e(m, o))
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');

DO $depois$
BEGIN
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> '964978af8273a03b02f19e66eb96b3ae'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> '28f8bf52df1a64a2814ea762cd3b11fc'
     OR (SELECT md5(modulos::text) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> 'f238e0ac931f42447f98ab7e000e4f24'
     OR (SELECT md5(modulos::text) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> 'f238e0ac931f42447f98ab7e000e4f24' THEN
    RAISE EXCEPTION 'O resultado não bateu com a proposta: nada é gravado.';
  END IF;
END $depois$;
COMMIT;

-- Como desfazer (volta ao texto de antes, guardado na cópia):
-- UPDATE public.ia_configuracoes i
--    SET instrucoes = a.value->>'instrucoes', modulos = a.value->'modulos'
--   FROM public.app_settings a
--  WHERE a.empresa_id = i.empresa_id AND a.key = 'alice_roteiro_copia_20261028_0909'
--    AND i.empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');
