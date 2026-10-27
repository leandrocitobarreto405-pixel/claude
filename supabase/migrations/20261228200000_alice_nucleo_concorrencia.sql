-- Alice: nova regra para cliente que fechou/vai fechar com outra empresa ou achou mais barato
-- (27/10, item 4): pergunta quanto ficou com a outra empresa e passa para a equipe (motivo
-- "concorrência"), sem "tudo bem"/"espero que dê certo". Turbine e Modelo Nexa. Guarda o núcleo de
-- antes em app_settings (alice_roteiro_copia_20261027_concorrencia), troca só a linha e confere o md5
-- antes e depois (se algo não bater, nada é gravado).
DO $antes$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') THEN
    RETURN;
  END IF;
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> '39a75688d9f61120e06bb3e8235f6f33'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> '8af39656da72ea738565dcedbdf757a6' THEN
    RAISE EXCEPTION 'O núcleo mudou desde a proposta: nada é gravado.';
  END IF;
END $antes$;

INSERT INTO public.app_settings (empresa_id, key, value)
SELECT empresa_id, 'alice_roteiro_copia_20261027_concorrencia',
       jsonb_build_object('instrucoes', instrucoes, 'md5', md5(instrucoes), 'salvo_em', now())
  FROM public.ia_configuracoes
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999')
ON CONFLICT DO NOTHING;

UPDATE public.ia_configuracoes
   SET instrucoes = replace(instrucoes,
         $t$- "Já fiz com outra empresa": agradeça, pergunte como foi, deixe a porta aberta, registre o motivo.$t$,
         $t$- Fechou ou vai fechar com outra empresa, ou achou mais barato: NUNCA, em hipótese alguma, diga "tudo bem", "espero que dê certo", "fico feliz que resolveu", "boa sorte" nem encerre a conversa. Use SEMPRE o nome do cliente. Responda: "Poxa, que pena, [nome]! [Nome], a gente faz questão de te atender. Deixa eu te perguntar uma coisa: quanto ficou com a outra empresa? Você consegue me falar? Aí eu posso ver aqui com o meu gestor se eu consigo fazer uma condição melhor pra você." Quando o cliente passar o valor, agradeça, diga que vai falar com o gestor e já retorna, e transfira (motivo "concorrência"; no resumo: valor da concorrência, valor do nosso orçamento e o que o cliente disse). Você não dá desconto por conta própria.
- Já fez o serviço com outra empresa: não insista no preço. Pergunte como ficou e ofereça contato para a próxima manutenção.$t$)
 WHERE empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');

DO $depois$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') THEN
    RETURN;
  END IF;
  IF (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111') <> 'a5138f93420dbe53fa3064c4e53646e3'
     OR (SELECT md5(instrucoes) FROM public.ia_configuracoes WHERE empresa_id = '99999999-9999-4999-8999-999999999999') <> '90701374d8328f80cdba93fbc7a20995' THEN
    RAISE EXCEPTION 'Núcleo novo não confere.';
  END IF;
  IF (SELECT count(*) FROM public.app_settings WHERE key = 'alice_roteiro_copia_20261027_concorrencia') <> 2 THEN
    RAISE EXCEPTION 'Cópia do núcleo de antes não ficou guardada.';
  END IF;
END $depois$;
