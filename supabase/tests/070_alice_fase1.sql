-- Alice, fase 1: IA desligada por cliente, follow-up cancelado quando o cliente responde ou um
-- humano entra, mídias só da pasta da empresa.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

CREATE FUNCTION pg_temp.msg(_id int, _conversa int, _tipo text, _texto text,
  _situacao text DEFAULT 'pending', _remetente text DEFAULT 'contact')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.receber_evento_chatwoot('token-f1', 'f' || _id, jsonb_build_object(
    'event', 'message_created', 'id', _id, 'message_type', _tipo, 'content', _texto,
    'private', false, 'created_at', '2026-09-28T12:00:00Z',
    'account', jsonb_build_object('id', 187966), 'inbox', jsonb_build_object('id', 12),
    'sender', jsonb_build_object('id', 900 + _conversa, 'type', _remetente),
    'conversation', jsonb_build_object('id', _conversa, 'inbox_id', 12, 'status', _situacao,
      'channel', 'Channel::Whatsapp', 'updated_at', 1790000000 + _id,
      'meta', jsonb_build_object('sender', jsonb_build_object('id', 500 + _conversa,
        'name', 'Cliente ' || _conversa, 'phone_number', '+55119800' || lpad(_conversa::text, 5, '0'))))));
$$;

CREATE FUNCTION pg_temp.tarefas(_conversa int) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(t.tipo || ':' || t.situacao, ',' ORDER BY t.tipo, t.situacao), '-')
    FROM public.ia_tarefas t JOIN public.conversas c ON c.id = t.conversa_id
   WHERE c.chatwoot_conversation_id = _conversa;
$$;

-- Follow-up da Alice (como a ferramenta agendar_followup cria): tarefa + repescagem ligada.
CREATE FUNCTION pg_temp.followup(_conversa int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  c public.conversas;
  t uuid;
BEGIN
  SELECT * INTO c FROM public.conversas WHERE chatwoot_conversation_id = _conversa;
  INSERT INTO public.ia_tarefas (empresa_id, conversa_id, tipo, executar_apos, dados)
  VALUES (c.empresa_id, c.id, 'followup', now() + interval '10 minutes', '{"trilha":"A"}')
  RETURNING id INTO t;
  INSERT INTO public.crm_followups (empresa_id, crm_lead_id, scheduled_at, responsavel, ia_tarefa_id)
  VALUES (c.empresa_id, c.crm_lead_id, now() + interval '10 minutes', 'alice', t);
  UPDATE public.crm_leads SET next_follow_up_at = now() + interval '10 minutes' WHERE id = c.crm_lead_id;
  RETURN t;
END $$;

CREATE FUNCTION pg_temp.repescagem(_tarefa uuid) RETURNS text LANGUAGE sql AS $$
  SELECT status || ':' || coalesce(result, '') FROM public.crm_followups WHERE ia_tarefa_id = _tarefa;
$$;

INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('44444444-4444-4444-4444-444444444444', 'Nexa', 187966, 'token-f1');
INSERT INTO public.chatwoot_inboxes (conexao_id, inbox_id, empresa_id) VALUES
  ('44444444-4444-4444-4444-444444444444', 12, '11111111-1111-1111-1111-111111111111');
INSERT INTO public.ia_configuracoes (empresa_id, ativo, espera_segundos)
VALUES ('11111111-1111-1111-1111-111111111111', true, 8);

-- 1. Cliente responde: o follow-up pendente é cancelado junto com a repescagem.
SELECT pg_temp.msg(1, 1, 'incoming', 'Oi');
UPDATE public.ia_tarefas SET situacao = 'concluida';
CREATE TEMP TABLE f1 AS SELECT pg_temp.followup(1) AS id;
SELECT pg_temp.ok(pg_temp.tarefas(1) = 'followup:pendente,responder:concluida', 'follow-up agendado');
SELECT pg_temp.msg(2, 1, 'incoming', 'Voltei, pode agendar?');
SELECT pg_temp.ok(pg_temp.tarefas(1) = 'followup:ignorada,responder:concluida,responder:pendente',
  'cliente respondeu: ' || pg_temp.tarefas(1));
SELECT pg_temp.ok(pg_temp.repescagem((SELECT id FROM f1)) = 'Cancelada:cliente respondeu',
  'repescagem da Alice cancelada: ' || pg_temp.repescagem((SELECT id FROM f1)));
SELECT pg_temp.ok((SELECT l.next_follow_up_at IS NULL FROM public.crm_leads l
  JOIN public.conversas c ON c.crm_lead_id = l.id WHERE c.chatwoot_conversation_id = 1),
  'próximo retorno do lead limpo');

-- 2. Resposta do próprio robô não cancela o follow-up.
UPDATE public.ia_tarefas SET situacao = 'concluida' WHERE situacao = 'pendente';
CREATE TEMP TABLE f2 AS SELECT pg_temp.followup(1) AS id;
SELECT pg_temp.msg(3, 1, 'outgoing', 'Oi! Sou a Alice', 'pending', 'agent_bot');
SELECT pg_temp.ok(pg_temp.repescagem((SELECT id FROM f2)) = 'Pendente:', 'mensagem do robô mantém o follow-up');

-- 3. Atendente humano escreve: follow-up cancelado.
SELECT pg_temp.msg(4, 1, 'outgoing', 'Oi, aqui é a Carol', 'pending', 'user');
SELECT pg_temp.ok(pg_temp.repescagem((SELECT id FROM f2)) = 'Cancelada:atendente humano assumiu',
  'humano cancela o follow-up: ' || pg_temp.repescagem((SELECT id FROM f2)));

-- 4. Conversa sai de pendente no Chatwoot: follow-up cancelado.
SELECT pg_temp.msg(5, 5, 'incoming', 'Oi');
UPDATE public.ia_tarefas SET situacao = 'concluida' WHERE situacao = 'pendente';
CREATE TEMP TABLE f5 AS SELECT pg_temp.followup(5) AS id;
UPDATE public.conversas SET status = 'resolved' WHERE chatwoot_conversation_id = 5;
SELECT pg_temp.ok(pg_temp.repescagem((SELECT id FROM f5)) = 'Cancelada:conversa saiu do atendimento do robô',
  'conversa resolvida cancela o follow-up');

-- 5. IA desligada no cliente: cancela o agendado e não agenda mais nada.
SELECT pg_temp.msg(6, 6, 'incoming', 'Oi');
CREATE TEMP TABLE f6 AS SELECT pg_temp.followup(6) AS id;
UPDATE public.whatsapp_contacts SET ia_desligada = true
 WHERE id = (SELECT whatsapp_contact_id FROM public.conversas WHERE chatwoot_conversation_id = 6);
SELECT pg_temp.ok(pg_temp.tarefas(6) = 'followup:ignorada,responder:ignorada',
  'IA desligada cancela tudo: ' || pg_temp.tarefas(6));
SELECT pg_temp.ok(pg_temp.repescagem((SELECT id FROM f6)) = 'Cancelada:IA desligada para o cliente',
  'repescagem cancelada ao desligar a IA');
SELECT pg_temp.msg(7, 6, 'incoming', 'Alguém aí?');
SELECT pg_temp.ok(pg_temp.tarefas(6) = 'followup:ignorada,responder:ignorada', 'IA desligada não agenda');

-- 6. Mídias: só arquivos da pasta da própria empresa.
UPDATE public.ia_configuracoes SET video_higienizacao = '11111111-1111-1111-1111-111111111111/video.mp4';
DO $$ BEGIN
  UPDATE public.ia_configuracoes SET audio_higienizacao = '22222222-2222-2222-2222-222222222222/audio.ogg';
  RAISE EXCEPTION 'FALHOU: aceitou mídia de outra empresa';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  UPDATE public.ia_configuracoes SET hora_inicio = 21, hora_fim = 8;
  RAISE EXCEPTION 'FALHOU: aceitou horário invertido';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- 7. Repescagem não pode apontar para tarefa de outra empresa.
INSERT INTO public.empresas (id, nome) VALUES ('22222222-2222-2222-2222-222222222222', 'Cliente B');
INSERT INTO public.crm_leads (empresa_id, lead_name, phone) VALUES
  ('22222222-2222-2222-2222-222222222222', 'B', '11999990000');
DO $$ BEGIN
  INSERT INTO public.crm_followups (empresa_id, crm_lead_id, ia_tarefa_id)
  SELECT '22222222-2222-2222-2222-222222222222', l.id, (SELECT id FROM f6)
    FROM public.crm_leads l WHERE l.empresa_id = '22222222-2222-2222-2222-222222222222';
  RAISE EXCEPTION 'FALHOU: repescagem ligada à tarefa de outra empresa';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
END $$;

ROLLBACK;
