-- Alice: seção Follow-up do núcleo com a cadência garantida pelo sistema (C/D, 27/10), sem o "fim da
-- validade: transferir"; a condição do último follow-up entra nos descontos permitidos. Turbine e
-- Modelo Nexa. Guarda o núcleo de antes em app_settings (alice_roteiro_copia_20261027_followup), troca
-- só os trechos e confere o md5 antes e depois (se algo não bater, nada é gravado).
DO $antes$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') THEN
    RETURN;
  END IF;
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> 'c4b519a9f3608fd3b2ace6ff87698543'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> '4f4387b00d650b17b7220befe16ee871' THEN
    RAISE EXCEPTION 'O núcleo mudou desde a proposta: nada é gravado.';
  END IF;
END $antes$;

INSERT INTO public.app_settings (empresa_id, key, value)
SELECT empresa_id, 'alice_roteiro_copia_20261027_followup',
       jsonb_build_object('instrucoes', instrucoes, 'md5', md5(instrucoes), 'salvo_em', now())
  FROM public.ia_configuracoes
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999')
ON CONFLICT DO NOTHING;

UPDATE public.ia_configuracoes
   SET instrucoes = replace(replace(replace(replace(replace(instrucoes,
         $t$Use `agendar_followup` sempre que o cliente parar de responder, e agende o próximo toque toda vez que mandar um. Cada toque traz algo novo; nunca "está aí?" nem só o nome com interrogação; no máximo um toque por período do dia; cliente disse não → pare, agradeça e `registrar_motivo_perda`.$t$,
         $t$Os toques das trilhas A e B o sistema agenda sozinho depois de cada resposta sua (não use `agendar_followup` para eles): na hora de cada toque você recebe o guia e escreve a mensagem dentro da janela de 24 h; fora dela vai o modelo aprovado pela Meta ou a equipe assume. Use `agendar_followup` só para a trilha C (data combinada) ou um toque curto de até 30 minutos (ex.: o orçamento depois do vídeo). Qualquer mensagem do cliente cancela os toques e a sequência recomeça da sua última resposta. Cada toque traz algo novo; nunca "está aí?" nem só o nome com interrogação; cliente disse não → pare, agradeça e `registrar_motivo_perda`.$t$),
         $t$**Trilha A — sumiu depois do orçamento:** 10 min: "Conseguiu dar uma olhadinha no orçamento, [nome]?" · 2–3 h: volte na dor ("Fiquei pensando no que você falou do [pet/mancha/sofá novo]. [Um benefício ligado a isso]. Ficou alguma dúvida sobre isso?") · Dia seguinte: "Bom dia, [nome]! Essa semana tenho [dia] à tarde e [dia] de manhã. Algum desses funciona pra você?" (horários reais) · Fim da validade: NÃO envie texto; `transferir_para_humano` (motivo "áudio validade") · 3–5 dias: "Oi, [nome], tudo bem? Já realizou o serviço?" · 7 dias: "Você decidiu deixar pra mais pra frente ou ficou acima do que imaginava? Pode me falar tranquilo, é só pra eu organizar aqui 😊" · 30 dias: tarefa para a vendedora.$t$,
         $t$**Trilha A — sumiu depois do orçamento:** 10 min: "Conseguiu ver o orçamento que te passei, [nome]?" · 40 min: "Oi, [nome]! Ficou com alguma dúvida sobre o orçamento?" · Dia seguinte 10h: dois horários reais da agenda (`consultar_agenda`) · Dia seguinte 14h: "Seu orçamento vence amanhã. Quer garantir um desses horários?" · D2 16h (só com a oferta ligada): "Oi, [nome]! Consegui uma condição melhor pra você, em cima do valor que te passei, porque liberou uma vaga nesta semana. Vale até amanhã. Quer que eu te mostre?" (se ele quiser ver, refaça o orçamento com o desconto "oferta_followup"; nunca diga o valor antes) · Sem resposta: o lead vai para "Orçamentos sem desfecho".$t$),
         $t$**Trilha B — sumiu antes do orçamento:** 15 min sem responder sobre o vídeo: mande o orçamento (Passo 2) · 10 min: "[Nome], conseguiu tirar a foto do estofado? Pode ser do celular mesmo, bem simples 😊" · 2–3 h: "Se preferir, me diz só o tipo e o tamanho (ex.: retrátil de 2 módulos, uns 2 metros) que eu já te passo uma ideia de valor. Pode ser?" · Dia seguinte: "Bom dia, [nome]! Ainda quer cuidar do seu estofado? Consigo te passar o orçamento rapidinho hoje, bora?" · 5–7 dias: "Oi, [nome]! Ainda faz sentido pra você ou deixou pra outro momento?"$t$,
         $t$**Trilha B — sumiu antes do orçamento:** 15 min sem responder sobre o vídeo: mande o orçamento (Passo 2) · 10 min: "[Nome], conseguiu tirar a foto do estofado? Pode ser do celular mesmo, bem simples 😊" (ou o CEP, se a foto já veio) · 40 min: "Se preferir, me diz só o tipo e o tamanho (ex.: retrátil de 2 módulos, uns 2 metros) e o seu CEP, que eu já te passo o orçamento. Pode ser?" · Dia seguinte 10h: "Bom dia, [nome]! Ainda quer cuidar do seu estofado? Com a foto e o CEP eu te passo o orçamento hoje, combinado?" · D2 16h: "Vou deixar seu atendimento aqui separadinho. Quando quiser o orçamento, é só me responder por aqui." · Sem resposta: "Orçamentos sem desfecho" (motivo "Sumiu antes do orçamento").$t$),
         $t$- **Descontos permitidos:** a condição da campanha (só para quem veio do disparo, nas datas); indicação (15% no primeiro serviço do indicado; 15% no próximo de quem indicou); o desconto de item adicional do upsell; o Pix de 5% sobre o total com desconto. Qualquer outro, ou somar campanha com indicação, transfira.$t$,
         $t$- **Descontos permitidos:** a condição da campanha (só para quem veio do disparo, nas datas); indicação (15% no primeiro serviço do indicado; 15% no próximo de quem indicou); o desconto de item adicional do upsell; a condição do último follow-up (só depois que o sistema mandou a oferta do D2 nesta conversa, até o dia seguinte: desconto "oferta_followup"); o Pix de 5% sobre o total com desconto. Qualquer outro, ou somar campanha com indicação, transfira.$t$),
         $t$- Agendamento sem a ferramenta de agenda; fim da validade (tarefa de áudio) e 30 dias sem resposta.$t$,
         $t$- Agendamento sem a ferramenta de agenda.$t$)
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');

DO $depois$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') THEN
    RETURN;
  END IF;
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> '39a75688d9f61120e06bb3e8235f6f33'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> '8af39656da72ea738565dcedbdf757a6' THEN
    RAISE EXCEPTION 'Núcleo novo não confere.';
  END IF;
  IF (SELECT count(*) FROM public.app_settings WHERE key = 'alice_roteiro_copia_20261027_followup') <> 2 THEN
    RAISE EXCEPTION 'Cópia do núcleo de antes não ficou guardada.';
  END IF;
END $depois$;
