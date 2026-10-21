-- Nome confirmado (migração 20261129120000): origem só com os valores previstos, contador de
-- perguntas começa em 0 e a atualização do nome do perfil (webhook) não apaga o nome confirmado.
-- Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

\set E '56000000-0000-0000-0000-00000000000e'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 560');
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('56000000-0000-0000-0000-0000000000cc', 'Nexa', 187966, 'token-p560');
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone, profile_name)
VALUES ('56000000-0000-0000-0000-0000000000a1', :'E', '5511970005601', 'Perfil Fictício');
INSERT INTO public.conversas (id, empresa_id, conexao_id, chatwoot_conversation_id, whatsapp_contact_id, status)
VALUES ('56000000-0000-0000-0000-0000000000c1', :'E', '56000000-0000-0000-0000-0000000000cc', 5601, '56000000-0000-0000-0000-0000000000a1', 'pending');

SELECT pg_temp.ok((SELECT nome_perguntas FROM public.conversas WHERE id = '56000000-0000-0000-0000-0000000000c1') = 0, 'perguntas começa em 0');

-- Origem inválida é recusada (contato e conversa).
DO $$
BEGIN
  UPDATE public.whatsapp_contacts SET nome_confirmado = 'Beatriz', nome_confirmado_origem = 'chute'
   WHERE id = '56000000-0000-0000-0000-0000000000a1';
  RAISE EXCEPTION 'FALHOU: contato aceitou origem inválida';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
DO $$
BEGIN
  UPDATE public.conversas SET nome_confirmado_origem = 'chute' WHERE id = '56000000-0000-0000-0000-0000000000c1';
  RAISE EXCEPTION 'FALHOU: conversa aceitou origem inválida';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
DO $$
BEGIN
  UPDATE public.conversas SET nome_perguntas = 11 WHERE id = '56000000-0000-0000-0000-0000000000c1';
  RAISE EXCEPTION 'FALHOU: perguntas aceitou 11';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

-- Nome informado pelo cliente; o perfil muda depois (webhook) e o nome confirmado continua.
UPDATE public.whatsapp_contacts
   SET nome_confirmado = 'Beatriz', nome_confirmado_origem = 'cliente', nome_confirmado_em = now()
 WHERE id = '56000000-0000-0000-0000-0000000000a1';
UPDATE public.whatsapp_contacts SET profile_name = 'Outro Perfil' WHERE id = '56000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.ok(
  (SELECT nome_confirmado = 'Beatriz' AND nome_confirmado_origem = 'cliente' AND profile_name = 'Outro Perfil'
     FROM public.whatsapp_contacts WHERE id = '56000000-0000-0000-0000-0000000000a1'),
  'nome confirmado sobrevive à troca do perfil');

ROLLBACK;
