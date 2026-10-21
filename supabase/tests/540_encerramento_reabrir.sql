-- Encerramento automático (migração 20261127120000): mensagem do cliente numa conversa encerrada
-- volta para quem estava com ela. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

\set E '54000000-0000-0000-0000-00000000000e'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 540');
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('54000000-0000-0000-0000-0000000000cc', 'Nexa', 187966, 'token-p540');
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone, profile_name)
VALUES ('54000000-0000-0000-0000-0000000000a1', :'E', '5511970005401', 'Cliente Fictício 540 A'),
       ('54000000-0000-0000-0000-0000000000a2', :'E', '5511970005402', 'Cliente Fictício 540 B'),
       ('54000000-0000-0000-0000-0000000000a3', :'E', '5511970005403', 'Cliente Fictício 540 C');
-- Três conversas encerradas: estava com a Alice, estava com a equipe, encerrada antes da marca.
INSERT INTO public.conversas (id, empresa_id, conexao_id, chatwoot_conversation_id, whatsapp_contact_id, status, encerrada_de, encerrada_em)
VALUES ('54000000-0000-0000-0000-0000000000c1', :'E', '54000000-0000-0000-0000-0000000000cc', 5401, '54000000-0000-0000-0000-0000000000a1', 'resolved', 'alice', now() - interval '1 day'),
       ('54000000-0000-0000-0000-0000000000c2', :'E', '54000000-0000-0000-0000-0000000000cc', 5402, '54000000-0000-0000-0000-0000000000a2', 'resolved', 'equipe', now() - interval '1 day'),
       ('54000000-0000-0000-0000-0000000000c3', :'E', '54000000-0000-0000-0000-0000000000cc', 5403, '54000000-0000-0000-0000-0000000000a3', 'resolved', NULL, NULL);

-- A marca só aceita alice/equipe.
DO $$
BEGIN
  UPDATE public.conversas SET encerrada_de = 'robo' WHERE id = '54000000-0000-0000-0000-0000000000c3';
  RAISE EXCEPTION 'FALHOU: encerrada_de aceitou valor inválido';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

-- Cliente escreve na conversa que estava com a Alice: marca limpa e tarefa de devolver à Alice.
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, direction, message_type, text_content, origem)
VALUES (:'E', '54000000-0000-0000-0000-0000000000a1', '54000000-0000-0000-0000-0000000000c1', 'Recebida', 'Texto', 'oi de novo 540', 'chatwoot');
SELECT pg_temp.ok(
  (SELECT encerrada_de IS NULL AND encerrada_em IS NULL FROM public.conversas WHERE id = '54000000-0000-0000-0000-0000000000c1'),
  'marca de encerramento limpa ao reabrir');
SELECT pg_temp.ok(
  (SELECT count(*) FROM public.ia_tarefas
    WHERE conversa_id = '54000000-0000-0000-0000-0000000000c1' AND tipo = 'devolver_para_alice' AND situacao = 'pendente') = 1,
  'conversa que estava com a Alice volta para a Alice');
-- Segunda mensagem: não duplica a tarefa.
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, direction, message_type, text_content, origem)
VALUES (:'E', '54000000-0000-0000-0000-0000000000a1', '54000000-0000-0000-0000-0000000000c1', 'Recebida', 'Texto', 'alô? 540', 'chatwoot');
SELECT pg_temp.ok(
  (SELECT count(*) FROM public.ia_tarefas
    WHERE conversa_id = '54000000-0000-0000-0000-0000000000c1' AND tipo = 'devolver_para_alice') = 1,
  'uma tarefa só');

-- Estava com a equipe: marca limpa, nenhuma tarefa (o Chatwoot reabre como open, aba da equipe).
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, direction, message_type, text_content, origem)
VALUES (:'E', '54000000-0000-0000-0000-0000000000a2', '54000000-0000-0000-0000-0000000000c2', 'Recebida', 'Texto', 'oi 540 B', 'chatwoot');
SELECT pg_temp.ok(
  (SELECT encerrada_de IS NULL FROM public.conversas WHERE id = '54000000-0000-0000-0000-0000000000c2'),
  'marca limpa (equipe)');
SELECT pg_temp.ok(
  (SELECT count(*) FROM public.ia_tarefas WHERE conversa_id = '54000000-0000-0000-0000-0000000000c2' AND tipo = 'devolver_para_alice') = 0,
  'conversa da equipe não vai para a Alice');

-- Mensagem enviada (não do cliente) numa conversa marcada não reabre nada.
UPDATE public.conversas SET encerrada_de = 'alice' WHERE id = '54000000-0000-0000-0000-0000000000c2';
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, direction, message_type, text_content, origem, remetente_tipo)
VALUES (:'E', '54000000-0000-0000-0000-0000000000a2', '54000000-0000-0000-0000-0000000000c2', 'Enviada', 'Texto', 'nota 540', 'chatwoot', 'user');
SELECT pg_temp.ok(
  (SELECT encerrada_de = 'alice' FROM public.conversas WHERE id = '54000000-0000-0000-0000-0000000000c2'),
  'mensagem enviada não mexe na marca');

-- Sem marca: nada acontece.
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, direction, message_type, text_content, origem)
VALUES (:'E', '54000000-0000-0000-0000-0000000000a3', '54000000-0000-0000-0000-0000000000c3', 'Recebida', 'Texto', 'oi 540 C', 'chatwoot');
SELECT pg_temp.ok(
  (SELECT count(*) FROM public.ia_tarefas WHERE conversa_id = '54000000-0000-0000-0000-0000000000c3' AND tipo = 'devolver_para_alice') = 0,
  'sem marca, sem tarefa');

ROLLBACK;
