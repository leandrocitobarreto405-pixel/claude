-- Cadência do follow-up (migração 20261227120000): colunas novas e "respondido" no último toque
-- enviado quando o cliente escreve. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set T '11111111-1111-1111-1111-111111111111'
\set L '79000000-0000-4000-8000-000000000001'
\set C '79000000-0000-4000-8000-000000000002'
\set W '79000000-0000-4000-8000-000000000003'

INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, first_contact_date, is_open)
VALUES (:'L', :'T', 'Lead fictício 790', '11979000001', '5511979000001', current_date, true);
INSERT INTO public.whatsapp_contacts (id, empresa_id, wa_id, normalized_phone)
VALUES (:'W', :'T', '5511979000001', '5511979000001');
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('79000000-0000-4000-8000-0000000000c0', 'Conexão 790', 790, 'token-790');
INSERT INTO public.conversas (id, empresa_id, conexao_id, chatwoot_conversation_id, crm_lead_id)
VALUES (:'C', :'T', '79000000-0000-4000-8000-0000000000c0', 79001, :'L');

-- toques: A1 enviado há 2 h, A2 enviado há 1 h, A3 pendente
INSERT INTO public.crm_followups (empresa_id, crm_lead_id, conversa_id, scheduled_at, responsavel, status,
  completed_at, trilha, etapa, canal) VALUES
  (:'T', :'L', :'C', now() - interval '2 hours', 'alice', 'Concluída', now() - interval '2 hours', 'A', 'A1', 'texto'),
  (:'T', :'L', :'C', now() - interval '1 hour', 'alice', 'Concluída', now() - interval '1 hour', 'A', 'A2', 'texto'),
  (:'T', :'L', :'C', now() + interval '1 day', 'alice', 'Pendente', NULL, 'A', 'A3', NULL);

-- 1) mensagem da empresa não marca nada
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, crm_lead_id, direction, message_timestamp)
VALUES (:'T', :'W', :'C', :'L', 'Enviada', now());
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.crm_followups WHERE conversa_id = :'C' AND respondido_em IS NOT NULL),
                  'mensagem da empresa não é resposta');

-- 2) nota privada também não
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, crm_lead_id, direction, privada, message_timestamp)
VALUES (:'T', :'W', :'C', :'L', 'Recebida', true, now());
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.crm_followups WHERE conversa_id = :'C' AND respondido_em IS NOT NULL),
                  'nota privada não é resposta');

-- 3) cliente responde: marca só o último toque enviado (A2)
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, crm_lead_id, direction, message_timestamp)
VALUES (:'T', :'W', :'C', :'L', 'Recebida', now());
SELECT pg_temp.ok((SELECT string_agg(etapa, ',' ORDER BY etapa) FROM public.crm_followups
                    WHERE conversa_id = :'C' AND respondido_em IS NOT NULL) = 'A2', 'resposta conta para o A2');

-- 4) segunda mensagem não muda nada
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, crm_lead_id, direction, message_timestamp)
VALUES (:'T', :'W', :'C', :'L', 'Recebida', now());
SELECT pg_temp.ok((SELECT count(*) FROM public.crm_followups WHERE conversa_id = :'C' AND respondido_em IS NOT NULL) = 1,
                  'uma resposta por toque');

-- 5) lead "sem desfecho" volta quando o cliente escreve
UPDATE public.crm_leads SET sem_desfecho_em = now(), sem_desfecho_motivo = 'Não respondeu depois dos follow-ups' WHERE id = :'L';
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, conversa_id, crm_lead_id, direction, message_timestamp)
VALUES (:'T', :'W', :'C', :'L', 'Recebida', now());
SELECT pg_temp.ok((SELECT sem_desfecho_em IS NULL AND sem_desfecho_motivo IS NULL FROM public.crm_leads WHERE id = :'L'),
                  'cliente voltou: sai de sem desfecho');

-- 6) colunas novas com padrão seguro
SELECT pg_temp.ok((SELECT column_default FROM information_schema.columns WHERE table_name = 'ia_configuracoes'
                    AND column_name = 'followup_modelos') = 'false', 'modelos fora da janela começam desligados');
SELECT pg_temp.ok((SELECT column_default FROM information_schema.columns WHERE table_name = 'ia_configuracoes'
                    AND column_name = 'oferta_followup_ligada') = 'false', 'oferta começa desligada');
DO $n$ BEGIN
  INSERT INTO public.crm_followups (empresa_id, crm_lead_id, scheduled_at, responsavel, canal)
  VALUES ('11111111-1111-1111-1111-111111111111', '79000000-0000-4000-8000-000000000001', now(), 'alice', 'sms');
  RAISE EXCEPTION 'FALHOU: canal inválido aceito';
EXCEPTION WHEN check_violation THEN NULL;
END $n$;
ROLLBACK;
