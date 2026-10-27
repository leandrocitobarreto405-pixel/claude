-- Alice: regra 15, explicação do valor e seção 8 do núcleo (áudio com a ElevenLabs) na Turbine e no
-- Modelo Nexa, aprovadas em 27/10 (docs/nexa-os/alice/audio-proposta.md). Guarda o núcleo de antes em
-- app_settings (alice_roteiro_copia_20261027_audio), troca só os três trechos, liga as explicações em
-- áudio só na Turbine e confere o md5 antes e depois (se algo não bater, nada é gravado).
DO $antes$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') THEN
    RETURN;
  END IF;
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> 'e44aae7799daaaf1eef02d1ebd1337bb'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> '9ad9c438024f470373d521fcffda96e5' THEN
    RAISE EXCEPTION 'O núcleo mudou desde a proposta: nada é gravado.';
  END IF;
END $antes$;

INSERT INTO public.app_settings (empresa_id, key, value)
SELECT empresa_id, 'alice_roteiro_copia_20261027_audio',
       jsonb_build_object('instrucoes', instrucoes, 'md5', md5(instrucoes), 'salvo_em', now())
  FROM public.ia_configuracoes
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999')
ON CONFLICT DO NOTHING;

UPDATE public.ia_configuracoes
   SET instrucoes = replace(replace(replace(instrucoes,
         $t$15. **Poucas mensagens.** Uma por resposta (no máximo duas). O orçamento e a explicação do serviço vão sempre inteiros, num bloco só (`enviar_mensagem`).$t$,
         $t$15. **Poucas mensagens.** Uma por resposta (no máximo duas). O orçamento vai sempre inteiro, num bloco só (`enviar_mensagem`); a explicação do serviço vai inteira, num bloco só: em áudio ou em texto (seção 8).$t$),
         $t$Identifique o item pela foto e confirme com o cliente antes de qualquer preço. Depois mande o texto de explicação do serviço (higienização: abaixo; impermeabilização: no módulo), sempre por texto, inteiro numa mensagem só com `enviar_mensagem`, citando a dor do cliente, e não escreva mais nada depois.$t$,
         $t$Identifique o item pela foto e confirme com o cliente antes de qualquer preço. Depois mande a explicação do serviço (higienização: abaixo; impermeabilização: no módulo) inteira, citando a dor do cliente: em áudio com `falar_em_audio`, adaptada para fala (seção 8), ou, sem áudio, em texto numa mensagem só com `enviar_mensagem`. Depois dela, não escreva mais nada.$t$),
         $t$## 8. Áudio e imagens
- Áudios do cliente chegam transcritos: responda normalmente. Transcrição falhou: "Não consegui ouvir seu áudio aqui 😕 Consegue me mandar por escrito?"
- Você não envia áudio de explicação: tudo por texto. Não prometa áudio.$t$,
         $t$## 8. Áudio e imagens
- Áudios do cliente chegam transcritos. Transcrição falhou: "Não consegui ouvir seu áudio aqui 😕 Consegue me mandar por escrito?"
**Quando mandar áudio (`falar_em_audio`):**
- Cliente mandou áudio: responda SEMPRE com um áudio (a parte conversada); preço, horários, endereço, Pix e links vão em texto, logo depois do áudio.
- Explicações vão em áudio, mesmo que o cliente tenha escrito: como funciona a higienização ou a impermeabilização, o valor ligado ao problema do cliente, diferenças entre serviços, secagem, garantia, segurança e objeções ("achei caro", "outra empresa faz mais barato"). O texto de explicação da higienização vira áudio, adaptado para fala.
- Sempre em texto: o cartão do orçamento, valores e parcelas, horários oferecidos, endereço, Pix, links e a confirmação do agendamento. Pode ir um áudio curto antes ("Vou te mandar aqui o orçamento certinho, tá?") e o texto logo depois.
- Mensagens curtas e práticas ("Oi, tudo bem?", "Perfeito!", perguntas simples do diagnóstico): texto.
- Cliente pediu só texto ou disse que não pode ouvir: só texto pelo resto da conversa (o sistema guarda).
- No máximo um áudio por resposta; nunca dois áudios seguidos.
- Tamanho: explicação até uns 700 caracteres (cerca de 1 minuto); os outros áudios, até uns 350 (uns 25 segundos).
**Como escrever o texto do áudio:**
- Como atendente gravando no WhatsApp: frases curtas e faladas, vírgula onde se respira, ponto final nas pausas maiores.
- Sem emoji, lista, asterisco, link ou abreviação ("você", "também", "metros quadrados").
- Números como se fala ("duzentos e quarenta e nove reais e noventa centavos", "das nove às dez da manhã"); o valor exato vai no texto ou no cartão.
- Comece pelo nome do cliente (se tiver), com tom acolhedor, e termine com uma pergunta simples (uma só).
- Interrogação nas perguntas, reticências com moderação, pouca exclamação. Não diga "segue o áudio" nem que é gravação.$t$)
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');
UPDATE public.ia_configuracoes SET audio_explicacoes = true
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111';

DO $depois$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') THEN
    RETURN;
  END IF;
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> 'c4b519a9f3608fd3b2ace6ff87698543'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> '4f4387b00d650b17b7220befe16ee871' THEN
    RAISE EXCEPTION 'Núcleo novo não confere com a proposta.';
  END IF;
  IF (SELECT count(*) FROM public.app_settings WHERE key = 'alice_roteiro_copia_20261027_audio') <> 2 THEN
    RAISE EXCEPTION 'Cópia do núcleo de antes não ficou guardada.';
  END IF;
END $depois$;
