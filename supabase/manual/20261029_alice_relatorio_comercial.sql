-- Alice, relatório do gerente comercial (29/10): itens 1 a 7 aprovados (item 3 só o texto; intervalos iguais).
-- Turbine e Modelo Nexa. Quebras de linha com chr(10). Confere o md5 antes e depois e que cada trecho
-- "antes" aparece uma vez só: se algo não bater, nada é gravado (a transação inteira volta).
-- Guarda o texto de antes em app_settings (alice_roteiro_copia_20261029).
-- Versão 2 (29/10, noite): item 3 com horário da agenda; item 6 sem regra de preço do box.
BEGIN;
DO $antes$
BEGIN
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> '964978af8273a03b02f19e66eb96b3ae'
     OR (SELECT md5(modulos::text) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> 'f238e0ac931f42447f98ab7e000e4f24'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> '28f8bf52df1a64a2814ea762cd3b11fc'
     OR (SELECT md5(modulos::text) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> 'f238e0ac931f42447f98ab7e000e4f24' THEN
    RAISE EXCEPTION 'O texto da Alice mudou desde a proposta: nada é gravado.';
  END IF;
END $antes$;

INSERT INTO public.app_settings (empresa_id, key, value)
SELECT empresa_id, 'alice_roteiro_copia_20261029',
       jsonb_build_object('instrucoes', instrucoes, 'modulos', modulos, 'md5', md5(instrucoes), 'salvo_em', now())
  FROM public.ia_configuracoes
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999')
ON CONFLICT DO NOTHING;

UPDATE public.ia_configuracoes
   SET instrucoes = replace(replace(replace(replace(replace(replace(replace(replace(instrucoes, $t$> Ficou alguma dúvida, [nome]?$t$, $t$> Posso te mandar seu orçamento agora, [nome]?$t$), $t$nunca mande "Ficou com alguma dúvida sobre o orçamento?".$t$, $t$nunca mande "Ficou com alguma dúvida sobre o orçamento?". Em nenhuma mensagem (orçamento, toques de follow-up e áudios) use "Ficou alguma dúvida?" nem parecido ("ficou com alguma dúvida?", "alguma dúvida?"): termine com uma pergunta que leve ao próximo passo ("Posso te mandar seu orçamento agora, [nome]?", "Quer que eu veja um horário pra você?").$t$), $t$- No máximo um áudio por resposta; nunca dois áudios seguidos.$t$, $t$- No máximo um áudio por resposta; nunca dois áudios seguidos.$t$ || chr(10) || $t$- Nunca termine um áudio com "ficou alguma dúvida?" (nem parecido): termine com uma pergunta que leve ao próximo passo.$t$), $t$**Não repita a pergunta:** se você perguntou algo e o cliente não respondeu, o toque seguinte não repete a pergunta nem cobra de outro jeito ("conseguiu ver com seu esposo?" e depois "ficou com alguma dúvida?" é cobrar de novo).$t$, $t$**Não repita a pergunta:** antes de cada mensagem, releia a conversa: nunca pergunte de novo tamanho, tipo, CEP, nome, o que incomoda, almofadas ou se o sofá é retrátil se o cliente já disse ou se a foto mostra. Se o cliente deu rua e bairro no lugar do CEP, aceite. Pergunta ainda sem resposta: não repita, só retome uma vez com algo novo e fácil de responder ("conseguiu ver com seu esposo?" e depois "ficou com alguma dúvida?" é cobrar de novo).$t$), $t$10 min: "Conseguiu ver o orçamento que te passei, [nome]?" · 40 min:$t$, $t$10 min: ofereça um horário concreto da agenda (ex.: "Tenho quinta de manhã livre, quer que eu reserve pra você, [nome]?"), sem perguntar se viu o orçamento e sem repetir os valores · 40 min:$t$), $t$- "Não tenho como mandar foto agora": siga sem foto (pergunte tipo e tamanho; o módulo diz o quê).$t$, $t$- Sem foto: se o cliente não mandou a foto, peça de novo uma vez, de forma leve ("pode ser do celular mesmo"). Se ele disser que não consegue, aceite tipo, tamanho e CEP (ou rua e bairro), mande o orçamento já avisando "o valor final o técnico confirma no local" e peça a foto depois, para confirmar o item.$t$), $t$- CEP fora da área (`consultar_cep`): transfira.$t$, $t$- CEP: peça uma única vez. Se `consultar_cep` não localizar, aceite rua e bairro e siga. Só diga que está fora da área depois de confirmar; nesse caso informe com clareza, sem prometer que a especialista "vai ver", transfira e diga em quanto tempo o cliente terá resposta.$t$), $t$2. **Empatia antes de processo.** Quando o cliente contar um problema (pet, mancha, cheiro, criança, mudança), acolha com as palavras dele antes de explicar qualquer coisa.$t$, $t$2. **Empatia antes de processo.** Quando o cliente contar um problema (pet, mancha, cheiro, criança, mudança), acolha com as palavras dele antes de explicar qualquer coisa, também com respostas curtas ("está sujo", "cheiro", "mancha"): a primeira frase acolhe com as palavras dele (ex.: "Poxa, sofá sujo incomoda mesmo, né?") e só depois vem a próxima pergunta. Se o cliente contou mudança, hospital, viagem ou saúde, comente isso primeiro.$t$),
       modulos = (SELECT jsonb_agg(CASE WHEN m->>'chave' = 'colchao' THEN jsonb_set(m, '{texto}', to_jsonb(replace(m->>'texto', $t$(dois lados = dupla face, regra do sistema).$t$, $t$(dois lados = dupla face, regra do sistema). Pergunte também se tem box ou cama baú.$t$))) WHEN m->>'chave' = 'impermeabilizacao' THEN jsonb_set(m, '{texto}', to_jsonb(replace(m->>'texto', $t$> Ficou alguma dúvida, [nome]?$t$, $t$> Posso te mandar seu orçamento agora, [nome]?$t$))) WHEN m->>'chave' = 'sofa' THEN jsonb_set(m, '{texto}', to_jsonb(replace(m->>'texto', $t$**Identificar pela foto e confirmar antes do preço:** "Pela foto, parece um sofá retrátil de 2 módulos, é isso? Você sabe mais ou menos a medida dele?".$t$, $t$**Identificar pela foto e confirmar antes do preço:** "Pela foto, parece um sofá retrátil de 2 módulos, é isso? Você sabe mais ou menos a medida dele?". Use sempre a medida e o número de módulos que o cliente informou (ex.: 1,50 m = faixa até 2,20 m; 2 módulos = retrátil 2 módulos). Antes de criar o orçamento, escreva no resumo o item e a faixa considerados e confirme com o cliente.$t$))) ELSE m END ORDER BY o) FROM jsonb_array_elements(modulos) WITH ORDINALITY e(m, o))
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');

DO $depois$
BEGIN
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> '1ccfb039745f97473c2227aebbe5fc9b'
     OR (SELECT md5(modulos::text) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> 'f189478be1be0ef8146ef1da711a5818'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> 'b16aacab078795a2a78566b89cbf44f7'
     OR (SELECT md5(modulos::text) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> 'f189478be1be0ef8146ef1da711a5818' THEN
    RAISE EXCEPTION 'O resultado não bateu com a proposta: nada é gravado.';
  END IF;
  IF (SELECT count(*) FROM public.app_settings WHERE key = 'alice_roteiro_copia_20261029' AND empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999')) <> 2 THEN
    RAISE EXCEPTION 'Cópia de antes não foi guardada: nada é gravado.';
  END IF;
END $depois$;
COMMIT;

-- Conferência (deve mostrar os md5 "depois"):
-- SELECT empresa_id, md5(instrucoes), md5(modulos::text) FROM public.ia_configuracoes WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');

-- Como desfazer (volta ao texto de antes, guardado na cópia):
-- UPDATE public.ia_configuracoes i
--    SET instrucoes = a.value->>'instrucoes', modulos = a.value->'modulos'
--   FROM public.app_settings a
--  WHERE a.empresa_id = i.empresa_id AND a.key = 'alice_roteiro_copia_20261029'
--    AND i.empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');
